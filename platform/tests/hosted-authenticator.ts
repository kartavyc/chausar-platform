// A software passkey for the hosted tests: real keys and real signatures, built offline, shaped like
// PublicKeyCredential.toJSON(). It is a test helper, not an authenticator anyone should use.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { encodeCbor, type CborValue } from '../runtime/hosted/cbor.ts';

export type SoftKind = 'p256' | 'ed25519' | 'rsa';
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();

export class SoftAuthenticator {
  readonly kind: SoftKind;
  readonly credentialId = randomBytes(32);
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  counter = 0;
  userHandle: string | null = null;

  constructor(kind: SoftKind = 'p256', options: { startCounter?: number } = {}) {
    this.kind = kind;
    this.counter = options.startCounter ?? 0;
    const pair = kind === 'p256' ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
      : kind === 'ed25519' ? generateKeyPairSync('ed25519') : generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey; this.publicKey = pair.publicKey;
  }

  get id(): string { return this.credentialId.toString('base64url'); }

  cose(): Map<CborValue, CborValue> {
    const jwk = this.publicKey.export({ format: 'jwk' }) as Record<string, string>;
    const b = (value: string) => Buffer.from(value, 'base64url');
    if (this.kind === 'p256') return new Map<CborValue, CborValue>([[1, 2], [3, -7], [-1, 1], [-2, b(jwk.x)], [-3, b(jwk.y)]]);
    if (this.kind === 'ed25519') return new Map<CborValue, CborValue>([[1, 1], [3, -8], [-1, 6], [-2, b(jwk.x)]]);
    return new Map<CborValue, CborValue>([[1, 3], [3, -257], [-1, b(jwk.n)], [-2, b(jwk.e)]]);
  }

  alg(): number { return this.kind === 'p256' ? -7 : this.kind === 'ed25519' ? -8 : -257; }

  signWith(data: Buffer): Buffer {
    if (this.kind === 'ed25519') return sign(null, data, this.privateKey);
    return sign('sha256', data, this.privateKey);
  }

  authData(rpId: string, flags: number, attested: boolean): Buffer {
    const head = Buffer.alloc(37);
    sha256(rpId).copy(head, 0);
    head[32] = flags | (attested ? 0x40 : 0);
    head.writeUInt32BE(this.counter, 33);
    if (!attested) return head;
    const length = Buffer.alloc(2); length.writeUInt16BE(this.credentialId.length);
    return Buffer.concat([head, Buffer.alloc(16), length, this.credentialId, encodeCbor(this.cose())]);
  }

  /** Answers creation options. fmt 'packed' signs a self attestation with the credential key. */
  create(options: any, overrides: { origin: string; fmt?: 'none' | 'packed'; flags?: number; challenge?: string; type?: string; rpId?: string }) {
    this.userHandle = options.user.id;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: overrides.type ?? 'webauthn.create', challenge: overrides.challenge ?? options.challenge, origin: overrides.origin, crossOrigin: false }));
    const authData = this.authData(overrides.rpId ?? options.rp.id, overrides.flags ?? 0x1d, true);
    const fmt = overrides.fmt ?? 'none';
    const attStmt = fmt === 'none' ? new Map<CborValue, CborValue>()
      : new Map<CborValue, CborValue>([['alg', this.alg()], ['sig', this.signWith(Buffer.concat([authData, sha256(clientDataJSON)]))]]);
    const attestationObject = encodeCbor(new Map<CborValue, CborValue>([['fmt', fmt], ['attStmt', attStmt], ['authData', authData]]));
    return {
      id: this.id, rawId: this.id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
      response: { clientDataJSON: clientDataJSON.toString('base64url'), attestationObject: attestationObject.toString('base64url'), transports: ['internal', 'hybrid'] },
    };
  }

  /** Answers request options. Each answer moves the counter on, as a real authenticator does (unless it stays at 0). */
  get(options: any, overrides: { origin: string; flags?: number; challenge?: string; bump?: boolean; rpId?: string; userHandle?: string | null }) {
    if (overrides.bump !== false && this.counter > 0) this.counter += 1;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: overrides.challenge ?? options.challenge, origin: overrides.origin, crossOrigin: false }));
    const authData = this.authData(overrides.rpId ?? options.rpId, overrides.flags ?? 0x1d, false);
    const signature = this.signWith(Buffer.concat([authData, sha256(clientDataJSON)]));
    const userHandle = overrides.userHandle === undefined ? this.userHandle : overrides.userHandle;
    return {
      id: this.id, rawId: this.id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
      response: { clientDataJSON: clientDataJSON.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url'), ...(userHandle ? { userHandle } : {}) },
    };
  }
}
