import { createServer, type Server } from 'node:http';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

// TEST ONLY. A loopback OpenID provider for platform/tests/release-enterprise-*.
// It is never imported by production code and is excluded from the Docker image.

export type TokenOptions = { alg?: 'RS256' | 'ES256' | 'none' | 'HS256'; kid?: string; badSignature?: boolean; claims?: Record<string, unknown>; omit?: string[] };
type Grant = { claims: Record<string, unknown>; nonce: string; challenge: string; redirectUri: string; options: TokenOptions };
const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export class FakeOidcProvider {
  issuer = ''; server: Server; clientId: string; clientSecret: string;
  rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }); ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  keys: Array<{ kid: string; alg: 'RS256' | 'ES256'; privateKey: KeyObject; publicKey: KeyObject }>;
  grants = new Map<string, Grant>(); tokenRequests = 0; jwksRequests = 0; metadataOverrides: Record<string, unknown> = {};
  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId; this.clientSecret = clientSecret;
    this.keys = [{ kid: 'rsa-1', alg: 'RS256', ...this.rsa }, { kid: 'ec-1', alg: 'ES256', ...this.ec }];
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', this.issuer);
      const json = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (url.pathname === '/.well-known/openid-configuration') return json(200, { issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks`, code_challenge_methods_supported: ['S256'], ...this.metadataOverrides });
      if (url.pathname === '/jwks') { this.jwksRequests++; return json(200, { keys: this.keys.map(key => ({ ...key.publicKey.export({ format: 'jwk' }), kid: key.kid, alg: key.alg, use: 'sig' })) }); }
      if (url.pathname === '/token' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(chunk)).on('end', () => {
          this.tokenRequests++;
          const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
          const expected = `Basic ${Buffer.from(`${encodeURIComponent(this.clientId)}:${encodeURIComponent(this.clientSecret)}`).toString('base64')}`;
          if (req.headers.authorization !== expected) return json(401, { error: 'invalid_client' });
          const grant = this.grants.get(form.get('code') ?? ''); this.grants.delete(form.get('code') ?? '');
          if (!grant || form.get('grant_type') !== 'authorization_code' || form.get('redirect_uri') !== grant.redirectUri) return json(400, { error: 'invalid_grant' });
          if (b64(createHash('sha256').update(form.get('code_verifier') ?? '').digest()) !== grant.challenge) return json(400, { error: 'invalid_grant' });
          json(200, { access_token: 'opaque-access', token_type: 'Bearer', id_token: this.idToken({ nonce: grant.nonce, ...grant.claims }, grant.options) });
        });
        return;
      }
      json(404, { error: 'not_found' });
    });
  }
  async start() {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    const address = this.server.address(); if (!address || typeof address !== 'object') throw new Error('No port');
    this.issuer = `http://127.0.0.1:${address.port}`; return this;
  }
  close() { return new Promise<void>(resolve => { this.server.closeAllConnections(); this.server.close(() => resolve()); }); }
  /** Signs a token; tests use the options to forge every refusal case. */
  idToken(claims: Record<string, unknown>, options: TokenOptions = {}): string {
    const alg = options.alg ?? 'RS256'; const now = Math.floor(Date.now() / 1000);
    const body: Record<string, unknown> = { iss: this.issuer, aud: this.clientId, iat: now, exp: now + 300, ...claims, ...options.claims };
    for (const key of options.omit ?? []) delete body[key];
    const key = this.keys.find(item => item.alg === alg);
    const header = { alg, typ: 'JWT', ...(alg === 'RS256' || alg === 'ES256' ? { kid: options.kid ?? key!.kid } : {}) };
    const data = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(body))}`;
    let signature = alg === 'none' ? Buffer.alloc(0)
      : alg === 'HS256' ? createHmac('sha256', this.clientSecret).update(data).digest()
        : alg === 'ES256' ? sign('sha256', Buffer.from(data), { key: key!.privateKey, dsaEncoding: 'ieee-p1363' }) : sign('sha256', Buffer.from(data), key!.privateKey);
    if (options.badSignature) { signature = Buffer.from(signature); signature[signature.length - 1] ^= 0x01; }
    return `${data}.${b64(signature)}`;
  }
  /** Plays the browser at the provider: accepts the authorization URL and returns a one-time code. */
  authorize(authorizationUrl: string, claims: Record<string, unknown>, options: TokenOptions & { nonce?: string } = {}): { code: string; state: string } {
    const url = new URL(authorizationUrl);
    if (url.origin !== this.issuer || url.pathname !== '/authorize' || url.searchParams.get('client_id') !== this.clientId || url.searchParams.get('code_challenge_method') !== 'S256' || url.searchParams.get('response_type') !== 'code') throw new Error('Unexpected authorization request');
    const code = randomBytes(16).toString('hex');
    this.grants.set(code, { claims, nonce: options.nonce ?? url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')!, redirectUri: url.searchParams.get('redirect_uri')!, options });
    return { code, state: url.searchParams.get('state')! };
  }
  rotate() { const fresh = generateKeyPairSync('rsa', { modulusLength: 2048 }); this.keys = [{ kid: 'rsa-2', alg: 'RS256', ...fresh }, ...this.keys.filter(key => key.alg !== 'RS256')]; }
}
export async function startFakeOidcProvider(clientId = 'chausar-test-client', clientSecret = 'test-client-secret-value') { return new FakeOidcProvider(clientId, clientSecret).start(); }
