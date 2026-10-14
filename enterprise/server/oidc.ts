import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import { check } from '../../platform/runtime/contracts.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type OidcClientOptions = {
  issuer: string; clientId: string; clientSecret: string; redirectUri: string; scopes: string[];
  fetch?: FetchLike; now?: () => number; clockSkewSeconds?: number; timeoutMs?: number;
  /** Trusted test composition only. Never read from configuration. */
  allowLoopbackHttpIssuer?: boolean;
};
export type OidcMetadata = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
export type VerifiedClaims = Readonly<Record<string, unknown>> & { iss: string; sub: string };
type Pending = { nonce: string; verifier: string; expiresAt: number };
type CachedKey = { kid?: string; alg: 'RS256' | 'ES256'; key: KeyObject };

const DOCUMENT_LIMIT = 256 * 1024;
const TOKEN_LIMIT = 16 * 1024;
const LOGIN_LIFETIME_MS = 10 * 60 * 1000;
const MAX_PENDING = 2000;
const MAX_KEYS = 50;
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MISS_INTERVAL_MS = 30 * 1000;
const b64url = (value: Buffer) => value.toString('base64url');
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sameText = (left: string, right: string) => { const a = sha256(left), b = sha256(right); return timingSafeEqual(a, b) && left === right; };

function decodeJson(segment: string, code: string): Record<string, unknown> {
  check(/^[A-Za-z0-9_-]+$/.test(segment), code, 'The identity token is not well formed.');
  let value: unknown; try { value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')); } catch { check(false, code, 'The identity token is not well formed.'); }
  check(record(value) && Object.getPrototypeOf(value) === Object.prototype, code, 'The identity token is not well formed.');
  check(!Object.hasOwn(value, '__proto__') && !Object.hasOwn(value, 'constructor') && !Object.hasOwn(value, 'prototype'), code, 'The identity token is not well formed.');
  return value;
}

/** Authorization-code flow with PKCE S256, single-use state and nonce, and local ID token verification. */
export class OidcClient {
  readonly options: Readonly<OidcClientOptions>;
  #fetch: FetchLike; #now: () => number; #skew: number; #timeout: number;
  #metadata: OidcMetadata | null = null; #pending = new Map<string, Pending>();
  #keys: CachedKey[] = []; #keysFetchedAt = 0; #keysRefreshing: Promise<void> | null = null;
  constructor(options: OidcClientOptions) {
    this.options = Object.freeze({ ...options, scopes: [...options.scopes] });
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init)); this.#now = options.now ?? Date.now;
    this.#skew = options.clockSkewSeconds ?? 60; this.#timeout = options.timeoutMs ?? 10_000;
    check(Number.isSafeInteger(this.#skew) && this.#skew >= 0 && this.#skew <= 300, 'OIDC_CONFIG_INVALID', 'Clock skew must be at most five minutes.');
    check(this.allowedUrl(options.issuer), 'OIDC_CONFIG_INVALID', 'The sign-in issuer must use https.');
    check(typeof options.clientId === 'string' && options.clientId.length > 0 && typeof options.clientSecret === 'string' && options.clientSecret.length > 0, 'OIDC_CONFIG_INVALID', 'The sign-in client needs an id and secret.');
    check(URL.canParse(options.redirectUri) && new URL(options.redirectUri).protocol === 'https:', 'OIDC_CONFIG_INVALID', 'The sign-in redirect must use https.');
  }
  private allowedUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 2048 || !URL.canParse(value)) return false;
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return this.options?.allowLoopbackHttpIssuer === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  }
  private async get(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    check(this.allowedUrl(url), 'OIDC_PROVIDER_INVALID', 'The sign-in provider published an endpoint that is not https.');
    let response: Response;
    try { response = await this.#fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.#timeout), headers: { accept: 'application/json', ...(init.headers as Record<string, string> ?? {}) } }); }
    catch { check(false, 'OIDC_PROVIDER_UNAVAILABLE', 'The sign-in provider could not be reached.'); }
    check(response.ok, 'OIDC_PROVIDER_REFUSED', 'The sign-in provider refused the request.');
    const declared = Number(response.headers.get('content-length') ?? '0');
    check(!(declared > DOCUMENT_LIMIT), 'OIDC_PROVIDER_INVALID', 'The sign-in provider reply is too large.');
    const chunks: Buffer[] = []; let size = 0;
    if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length; if (size > DOCUMENT_LIMIT) { await response.body.cancel().catch(() => {}); check(false, 'OIDC_PROVIDER_INVALID', 'The sign-in provider reply is too large.'); }
      chunks.push(Buffer.from(chunk));
    }
    let value: unknown; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { check(false, 'OIDC_PROVIDER_INVALID', 'The sign-in provider reply is not JSON.'); }
    check(record(value), 'OIDC_PROVIDER_INVALID', 'The sign-in provider reply is not an object.');
    return value;
  }
  async discover(): Promise<OidcMetadata> {
    if (this.#metadata) return this.#metadata;
    const issuer = this.options.issuer;
    const document = await this.get(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
    check(document.issuer === issuer, 'OIDC_ISSUER_MISMATCH', 'The sign-in provider reported a different issuer.');
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) check(this.allowedUrl(document[key]), 'OIDC_PROVIDER_INVALID', 'The sign-in provider published an endpoint that is not https.');
    const methods = document.code_challenge_methods_supported;
    check(methods === undefined || (Array.isArray(methods) && methods.includes('S256')), 'OIDC_PROVIDER_INVALID', 'The sign-in provider does not support PKCE S256.');
    this.#metadata = { issuer, authorization_endpoint: document.authorization_endpoint as string, token_endpoint: document.token_endpoint as string, jwks_uri: document.jwks_uri as string };
    return this.#metadata;
  }
  private prune() { const at = this.#now(); for (const [key, item] of this.#pending) if (item.expiresAt <= at) this.#pending.delete(key); }
  /** Returns the provider URL and the state value the caller binds to the browser. */
  async beginLogin(): Promise<{ url: string; state: string }> {
    const metadata = await this.discover();
    this.prune(); check(this.#pending.size < MAX_PENDING, 'OIDC_LOGIN_BUSY', 'Too many sign-ins are in progress. Try again shortly.');
    const state = b64url(randomBytes(32)), nonce = b64url(randomBytes(32)), verifier = b64url(randomBytes(48));
    this.#pending.set(b64url(sha256(state)), { nonce, verifier, expiresAt: this.#now() + LOGIN_LIFETIME_MS });
    const url = new URL(metadata.authorization_endpoint);
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: this.options.clientId, redirect_uri: this.options.redirectUri, scope: this.options.scopes.join(' '), state, nonce, code_challenge: b64url(sha256(verifier)), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
    return { url: url.toString(), state };
  }
  /** Consumes the state before any provider call, so a state value works once. */
  async completeLogin(input: { state: unknown; code: unknown }): Promise<VerifiedClaims> {
    check(typeof input.state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(input.state), 'OIDC_STATE_INVALID', 'This sign-in attempt is not recognised. Start again.');
    const key = b64url(sha256(input.state)); const pending = this.#pending.get(key); this.#pending.delete(key);
    check(pending && pending.expiresAt > this.#now(), 'OIDC_STATE_INVALID', 'This sign-in attempt is not recognised. Start again.');
    check(typeof input.code === 'string' && input.code.length > 0 && input.code.length <= 2048 && /^[\x21-\x7e]+$/.test(input.code), 'OIDC_CODE_INVALID', 'The sign-in provider returned no usable code.');
    const metadata = await this.discover();
    const basic = Buffer.from(`${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`).toString('base64');
    const tokens = await this.get(metadata.token_endpoint, { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: input.code, redirect_uri: this.options.redirectUri, code_verifier: pending.verifier }).toString() });
    check(typeof tokens.id_token === 'string', 'OIDC_TOKEN_INVALID', 'The sign-in provider returned no identity token.');
    return this.verifyIdToken(tokens.id_token, pending.nonce);
  }
  private async refreshKeys(force: boolean) {
    if (!force && this.#keys.length && this.#now() - this.#keysFetchedAt < JWKS_TTL_MS) return;
    if (force && this.#now() - this.#keysFetchedAt < JWKS_MISS_INTERVAL_MS) return;
    this.#keysRefreshing ??= (async () => {
      try {
        const metadata = await this.discover(); const document = await this.get(metadata.jwks_uri);
        check(Array.isArray(document.keys), 'OIDC_PROVIDER_INVALID', 'The sign-in provider key set is not well formed.');
        const keys: CachedKey[] = [];
        for (const jwk of document.keys.slice(0, MAX_KEYS)) {
          if (!record(jwk) || (jwk.use !== undefined && jwk.use !== 'sig') || (jwk.kid !== undefined && typeof jwk.kid !== 'string')) continue;
          const alg = jwk.kty === 'RSA' ? 'RS256' : jwk.kty === 'EC' && jwk.crv === 'P-256' ? 'ES256' : null;
          if (!alg || (jwk.alg !== undefined && jwk.alg !== alg)) continue;
          // Only public members reach the parser; private members are ignored.
          const material = alg === 'RS256' ? { kty: 'RSA', n: jwk.n, e: jwk.e } : { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
          try {
            const key = createPublicKey({ key: material as any, format: 'jwk' });
            if (alg === 'RS256' && (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) continue;
            keys.push({ kid: jwk.kid as string | undefined, alg, key });
          } catch { continue; }
        }
        this.#keys = keys; this.#keysFetchedAt = this.#now();
      } finally { this.#keysRefreshing = null; }
    })();
    await this.#keysRefreshing;
  }
  private findKey(alg: string, kid: unknown): CachedKey | undefined {
    const candidates = this.#keys.filter(item => item.alg === alg);
    if (typeof kid === 'string') return candidates.find(item => item.kid === kid);
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  async verifyIdToken(token: string, expectedNonce: string): Promise<VerifiedClaims> {
    check(typeof token === 'string' && token.length <= TOKEN_LIMIT, 'OIDC_TOKEN_INVALID', 'The identity token is not well formed.');
    const parts = token.split('.'); check(parts.length === 3, 'OIDC_TOKEN_INVALID', 'The identity token is not well formed.');
    const header = decodeJson(parts[0], 'OIDC_TOKEN_INVALID');
    check(header.alg === 'RS256' || header.alg === 'ES256', 'OIDC_ALGORITHM_REFUSED', 'The identity token uses a signature algorithm that is not accepted.');
    check(header.crit === undefined && header.jku === undefined && header.jwk === undefined && header.x5u === undefined, 'OIDC_TOKEN_INVALID', 'The identity token header is not accepted.');
    check(header.kid === undefined || (typeof header.kid === 'string' && header.kid.length <= 200), 'OIDC_TOKEN_INVALID', 'The identity token header is not accepted.');
    await this.refreshKeys(false);
    let key = this.findKey(header.alg, header.kid);
    if (!key) { await this.refreshKeys(true); key = this.findKey(header.alg, header.kid); }
    check(key, 'OIDC_KEY_UNKNOWN', 'The identity token was signed with an unknown key.');
    check(/^[A-Za-z0-9_-]+$/.test(parts[2]), 'OIDC_SIGNATURE_INVALID', 'The identity token signature is not valid.');
    const signature = Buffer.from(parts[2], 'base64url'); const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const valid = header.alg === 'ES256'
      ? signature.length === 64 && verify('sha256', data, { key: key.key, dsaEncoding: 'ieee-p1363' }, signature)
      : verify('sha256', data, key.key, signature);
    check(valid, 'OIDC_SIGNATURE_INVALID', 'The identity token signature is not valid.');
    const claims = decodeJson(parts[1], 'OIDC_TOKEN_INVALID'); const now = Math.floor(this.#now() / 1000);
    check(claims.iss === this.options.issuer, 'OIDC_CLAIMS_INVALID', 'The identity token comes from a different issuer.');
    const audience = claims.aud;
    check((typeof audience === 'string' && audience === this.options.clientId) || (Array.isArray(audience) && audience.length > 0 && audience.length <= 20 && audience.includes(this.options.clientId)), 'OIDC_CLAIMS_INVALID', 'The identity token is meant for a different client.');
    if (Array.isArray(audience) && audience.length > 1) check(claims.azp === this.options.clientId, 'OIDC_CLAIMS_INVALID', 'The identity token is meant for a different client.');
    check(claims.azp === undefined || claims.azp === this.options.clientId, 'OIDC_CLAIMS_INVALID', 'The identity token is meant for a different client.');
    check(Number.isSafeInteger(claims.exp) && (claims.exp as number) > now - this.#skew, 'OIDC_TOKEN_EXPIRED', 'The identity token has expired. Sign in again.');
    check(Number.isSafeInteger(claims.iat) && (claims.iat as number) <= now + this.#skew && (claims.iat as number) > now - 86400, 'OIDC_CLAIMS_INVALID', 'The identity token issue time is not acceptable.');
    check(claims.nbf === undefined || (Number.isSafeInteger(claims.nbf) && (claims.nbf as number) <= now + this.#skew), 'OIDC_CLAIMS_INVALID', 'The identity token is not valid yet.');
    check(typeof claims.nonce === 'string' && sameText(claims.nonce, expectedNonce), 'OIDC_NONCE_INVALID', 'The identity token does not belong to this sign-in attempt.');
    check(typeof claims.sub === 'string' && claims.sub.length > 0 && claims.sub.length <= 255, 'OIDC_CLAIMS_INVALID', 'The identity token names no subject.');
    return Object.freeze({ ...claims }) as VerifiedClaims;
  }
}
