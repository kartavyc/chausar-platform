import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, ChausarError, type Context } from '../contracts.ts';
import { boundedHttp, type BoundedHttp } from '../connectors.ts';
import type { CredentialRequest } from '../adapters/read-kit.ts';

/**
 * Connector credentials live outside workspace state, so exports, backups, sync and learning
 * never carry them. Each source has one file, sealed with AES-256-GCM under a key kept beside it
 * with owner-only permissions. Protection is the operating system's file permissions; the native
 * keychain is the intended home once the release lane exposes a general secret store.
 */
export type StoredCredential =
  | { kind: 'key'; system: string; secret: string; storedAt: string }
  | { kind: 'oauth'; system: string; provider: string; accessToken: string; refreshToken: string | null; expiresAt: string | null; scopes: string[]; settings: Record<string, string>; storedAt: string };
const SOURCE = /^[A-Za-z0-9_.:-]{1,100}$/;
/** One file per source, named by a reversible encoding so two ids can never share a file. */
const file = (directory: string, sourceId: string) => { check(SOURCE.test(sourceId), 'CREDENTIAL_SOURCE_INVALID', 'Choose a connection.'); return join(directory, `${Buffer.from(sourceId).toString('base64url')}.cred`); };
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
/** Read a private regular file through one descriptor, so the checked file is the file read. */
function readPrivate(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const info = fstatSync(fd);
    check(info.isFile() && info.size <= maxBytes && (process.platform === 'win32' || (info.mode & 0o077) === 0), 'CREDENTIAL_STORE_INVALID', 'A credential file is not a private regular file.');
    const buffer = Buffer.alloc(info.size); let read = 0;
    while (read < info.size) { const n = readSync(fd, buffer, read, info.size - read, read); if (n === 0) break; read += n; }
    return buffer.subarray(0, read);
  } finally { closeSync(fd); }
}

export class ConnectorCredentialStore {
  readonly #directory: string;
  constructor(directory: string) { this.#directory = directory; }
  #ensureDirectory() {
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    const info = lstatSync(this.#directory);
    check(info.isDirectory() && !info.isSymbolicLink(), 'CREDENTIAL_STORE_INVALID', 'The credential store is not a private directory.');
    if (process.platform !== 'win32') chmodSync(this.#directory, 0o700);
  }
  #key(create: boolean): Buffer | null {
    const path = join(this.#directory, '.key');
    if (!existsSync(path)) {
      if (!create) return null;
      this.#ensureDirectory();
      try { writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' }); }
      catch (error) { if ((error as any)?.code !== 'EEXIST') throw error; } // a concurrent first writer won; use its key
    }
    const key = readPrivate(path, 32);
    check(key.length === 32, 'CREDENTIAL_STORE_INVALID', 'The credential store key is not a regular private file.');
    return key;
  }
  set(sourceId: string, credential: StoredCredential): void {
    const key = this.#key(true)!, iv = randomBytes(12), path = file(this.#directory, sourceId);
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(sourceId));
    const sealed = Buffer.concat([cipher.update(JSON.stringify(credential), 'utf8'), cipher.final()]);
    const record = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), sealed: sealed.toString('base64') });
    // A fresh, randomly named temporary file opened exclusively: an existing file or link is never followed.
    const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    writeFileSync(temp, record, { mode: 0o600, flag: 'wx' }); renameSync(temp, path);
  }
  get(sourceId: string): StoredCredential | null {
    const path = file(this.#directory, sourceId);
    if (!existsSync(path)) return null;
    const key = this.#key(false); check(key, 'CREDENTIAL_STORE_INVALID', 'The credential store key is missing. Sign in again.');
    const content = readPrivate(path, 64 * 1024);
    try {
      const record = JSON.parse(content.toString('utf8'));
      const decipher = createDecipheriv('aes-256-gcm', key!, Buffer.from(record.iv, 'base64')); decipher.setAAD(Buffer.from(sourceId)); decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.sealed, 'base64')), decipher.final()]).toString('utf8'));
    } catch { throw new ChausarError('CREDENTIAL_STORE_INVALID', 'A stored credential could not be opened. Sign in again.'); }
  }
  remove(sourceId: string): boolean { const path = file(this.#directory, sourceId); const had = existsSync(path); rmSync(path, { force: true }); return had; }
  has(sourceId: string): { present: boolean; kind: StoredCredential['kind'] | null; storedAt: string | null } {
    const item = this.get(sourceId); return { present: !!item, kind: item?.kind ?? null, storedAt: item?.storedAt ?? null };
  }
}

/** Token endpoints for the browser sign-in providers. The client secret, where a provider needs one, comes from trusted config only. */
export function tokenEndpoint(provider: string, settings: Record<string, string>): string {
  switch (provider) {
    case 'google': return 'https://oauth2.googleapis.com/token';
    case 'zoho': check(['com', 'eu', 'in', 'com.au', 'jp', 'ca'].includes(settings.dataCenter ?? ''), 'REGION_REQUIRED', 'Choose the Zoho data centre.'); return `https://accounts.zoho.${settings.dataCenter}/oauth/v2/token`;
    case 'hubspot': return 'https://api.hubapi.com/oauth/v1/token';
    case 'xero': return 'https://identity.xero.com/connect/token';
    case 'quickbooks': return 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
    case 'shopify': check(/^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(settings.shop ?? ''), 'SHOP_REQUIRED', 'Enter the store\'s myshopify.com address.'); return `https://${settings.shop}/admin/oauth/access_token`;
    default: throw new ChausarError('OAUTH_CLIENT_REQUIRED', 'This system has no browser sign-in.');
  }
}
export type OAuthClient = { clientId: string; redirectUri: string; clientSecret?: string };
async function tokenRequest(http: BoundedHttp, url: string, form: Record<string, string>) {
  const response = await http({ url, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(form).toString(), maxBytes: 64 * 1024, timeoutMs: 15_000, redirect: 'error' })
    .catch(() => { throw new ChausarError('SOURCE_NETWORK_FAILED', 'Sign-in could not reach the system. Nothing was retried.'); });
  check(!response.url || response.url === url, 'HTTP_REDIRECT_REFUSED', 'Redirected responses are refused.');
  check(response.status >= 200 && response.status < 300, response.status === 400 || response.status === 401 ? 'SIGN_IN_REFUSED' : 'SOURCE_UNAVAILABLE', 'The system refused the sign-in. Start again.');
  let body: any; try { body = JSON.parse(typeof response.body === 'string' ? response.body : Buffer.from(response.body).toString('utf8')); } catch { throw new ChausarError('SIGN_IN_REFUSED', 'The system answered sign-in with something that is not a token.'); }
  check(body && typeof body.access_token === 'string' && body.access_token.length > 0 && body.access_token.length <= 8192 && !/[\r\n]/.test(body.access_token), 'SIGN_IN_REFUSED', 'The system answered sign-in without a usable token.');
  const seconds = Number(body.expires_in);
  return { accessToken: body.access_token as string, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token as string : null,
    expiresAt: Number.isSafeInteger(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null };
}

/** The broker, code exchange and database resolver the engine hands this module through hostOptions. */
export function hostCredentialServices(store: ConnectorCredentialStore, input: { clients: Record<string, OAuthClient>; http?: BoundedHttp }) {
  const http = input.http ?? boundedHttp;
  /** One refresh per source at a time: providers that rotate refresh tokens refuse a second concurrent refresh. */
  const refreshing = new Map<string, Promise<string>>();
  return {
    async credentialBroker(_ctx: Context, request: CredentialRequest): Promise<string> {
      const item = store.get(request.sourceId);
      check(item, 'CREDENTIAL_REQUIRED', 'Sign in to this system, or enter its key in Trust, credentials.');
      check(request.system === item.system || request.system.startsWith(`${item.system}-`), 'CREDENTIAL_REQUIRED', 'The stored credential belongs to another system.');
      if (item.kind === 'key') return item.secret;
      if (item.expiresAt && Date.parse(item.expiresAt) - 60_000 <= Date.now()) {
        const running = refreshing.get(request.sourceId); if (running) return running;
        const client = input.clients[item.provider];
        check(item.refreshToken && client, 'SOURCE_SIGN_IN_EXPIRED', 'The sign-in for this system has expired. Sign in again.');
        const pending = (async () => {
          const fresh = await tokenRequest(http, tokenEndpoint(item.provider, item.settings), { grant_type: 'refresh_token', refresh_token: item.refreshToken!, client_id: client!.clientId, ...(client!.clientSecret ? { client_secret: client!.clientSecret } : {}) });
          const next = { ...item, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken ?? item.refreshToken, expiresAt: fresh.expiresAt, storedAt: new Date().toISOString() };
          store.set(request.sourceId, next); return next.accessToken;
        })();
        refreshing.set(request.sourceId, pending);
        try { return await pending; } finally { refreshing.delete(request.sourceId); }
      }
      return item.accessToken;
    },
    async tokenExchange(_ctx: Context, request: { provider: string; code: string; verifier: string; redirectUri: string; scopes: string[]; connectionId: string; sourceId: string; settings: Record<string, string> }): Promise<{ ok: true }> {
      const client = input.clients[request.provider]; check(client, 'OAUTH_CLIENT_REQUIRED', 'Sign-in for this system needs a registered sign-in app.');
      check(request.redirectUri === client.redirectUri, 'OAUTH_REDIRECT_INVALID', 'Sign-in returned to an unexpected address.');
      const token = await tokenRequest(http, tokenEndpoint(request.provider, request.settings), { grant_type: 'authorization_code', code: request.code, code_verifier: request.verifier,
        redirect_uri: request.redirectUri, client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) });
      store.set(request.sourceId, { kind: 'oauth', system: request.provider, provider: request.provider, ...token, scopes: [...request.scopes], settings: { ...request.settings }, storedAt: new Date().toISOString() });
      return { ok: true };
    },
    async databaseCredentials(_ctx: Context, ref: string): Promise<string> {
      check(typeof ref === 'string' && SOURCE.test(ref), 'DB_CREDENTIAL_REQUIRED', 'Enter the database password in Trust, credentials.');
      const item = store.get(ref); check(item?.kind === 'key' && item.system === 'plain-database', 'DB_CREDENTIAL_REQUIRED', 'Enter the database password in Trust, credentials.');
      return item.secret;
    },
  };
}

/** Sign-in app registrations from a trusted config file installed with the app; never from a request. */
export function loadOAuthClients(path: string | undefined): Record<string, OAuthClient> {
  if (!path || !existsSync(path)) return {};
  const info = lstatSync(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) return {};
  let parsed: unknown; try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
  const out: Record<string, OAuthClient> = {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [provider, value] of Object.entries(parsed as Record<string, any>)) {
    if (!['google', 'zoho', 'hubspot', 'xero', 'quickbooks', 'shopify'].includes(provider) || !value || typeof value !== 'object') continue;
    if (typeof value.clientId !== 'string' || !/^[A-Za-z0-9._~-]{4,200}$/.test(value.clientId) || typeof value.redirectUri !== 'string') continue;
    try { const url = new URL(value.redirectUri); if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) continue; } catch { continue; }
    out[provider] = { clientId: value.clientId, redirectUri: value.redirectUri, ...(typeof value.clientSecret === 'string' && value.clientSecret.length <= 500 ? { clientSecret: value.clientSecret } : {}) };
  }
  return out;
}
