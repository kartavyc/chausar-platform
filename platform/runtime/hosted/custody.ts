// Chausar hosted tier: server custody of every business's vault key.
// A master key from the host's environment derives one key per tenant (HKDF). Each business vault opens with its own
// random passphrase, sealed with AES-256-GCM under its tenant's key and bound to tenant and business as associated
// data, so a sealed passphrase copied to another tenant or business never opens. This is server custody, not end to
// end encryption: whoever holds the master key can open every vault. docs/venture/hosted.md says so.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { ChausarError, check } from '../contracts.ts';

export type Sealed = { v: 1; key: string; nonce: string; tag: string; data: string };

const TENANT_ID = /^t_[a-f0-9]{24}$/;
const BUSINESS_ID = /^b_[a-f0-9]{24}$/;
const B64 = /^[A-Za-z0-9_-]*$/;

export const isTenantId = (value: unknown): value is string => typeof value === 'string' && TENANT_ID.test(value);
export const isBusinessId = (value: unknown): value is string => typeof value === 'string' && BUSINESS_ID.test(value);
export const newTenantId = () => `t_${randomBytes(12).toString('hex')}`;
export const newBusinessId = () => `b_${randomBytes(12).toString('hex')}`;

function bytes64(value: unknown, length?: number): Buffer {
  check(typeof value === 'string' && B64.test(value), 'CUSTODY_INVALID', 'A sealed value is malformed.');
  const decoded = Buffer.from(value, 'base64url');
  check(decoded.toString('base64url') === value && (length === undefined || decoded.length === length), 'CUSTODY_INVALID', 'A sealed value is malformed.');
  return decoded;
}

/** Reads the master key: 32 bytes as base64url (43 characters). Anything else is refused, never padded or hashed. */
export function parseMasterKey(value: unknown): Buffer {
  check(typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value), 'CUSTODY_KEY_INVALID', 'CHAUSAR_HOSTED_CUSTODY_KEY must be 32 random bytes as base64url (43 characters).');
  return bytes64(value, 32);
}

export class HostedCustody {
  readonly ephemeral: boolean;
  /** A short public fingerprint of the master key, stored beside each sealed value so a wrong key fails plainly. */
  readonly keyId: string;
  #master: Buffer;

  private constructor(master: Buffer, ephemeral: boolean) {
    check(master.length === 32, 'CUSTODY_KEY_INVALID', 'The custody key must be 32 bytes.');
    this.#master = Buffer.from(master);
    this.ephemeral = ephemeral;
    this.keyId = createHash('sha256').update('chausar.hosted.key-id.v1').update(master).digest('hex').slice(0, 16);
  }

  static fromKey(value: string): HostedCustody { return new HostedCustody(parseMasterKey(value), false); }
  /** Development only: a key that lives in this process. Every vault it seals is lost when the process stops. */
  static ephemeral(): HostedCustody { return new HostedCustody(randomBytes(32), true); }

  #derive(info: string, salt = ''): Buffer {
    return Buffer.from(hkdfSync('sha256', this.#master, Buffer.from(salt, 'utf8'), Buffer.from(info, 'utf8'), 32));
  }

  #seal(key: Buffer, plaintext: Buffer, aad: string): Sealed {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { v: 1, key: this.keyId, nonce: nonce.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
  }

  #open(key: Buffer, sealed: Sealed, aad: string): Buffer {
    check(sealed && typeof sealed === 'object' && sealed.v === 1, 'CUSTODY_INVALID', 'A sealed value is malformed.');
    check(sealed.key === this.keyId, 'CUSTODY_KEY_MISMATCH', 'This value was sealed with a different custody key.');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes64(sealed.nonce, 12));
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(bytes64(sealed.tag, 16));
      return Buffer.concat([decipher.update(bytes64(sealed.data)), decipher.final()]);
    } catch (error) {
      if (error instanceof ChausarError) throw error;
      throw new ChausarError('CUSTODY_INVALID', 'A sealed value could not be opened.');
    }
  }

  /** A fresh vault passphrase: 32 random bytes, 43 characters. Only its sealed form is ever written. */
  newVaultPassphrase(): string { return randomBytes(32).toString('base64url'); }

  wrapPassphrase(tenantId: string, businessId: string, passphrase: string): Sealed {
    check(isTenantId(tenantId) && isBusinessId(businessId), 'CUSTODY_INVALID', 'Unknown tenant or business.');
    check(typeof passphrase === 'string' && passphrase.length >= 12 && passphrase.length <= 1024, 'CUSTODY_INVALID', 'A vault passphrase must be 12 to 1024 characters.');
    const key = this.#derive('chausar.hosted.tenant.v1', tenantId);
    try { return this.#seal(key, Buffer.from(passphrase, 'utf8'), `chausar.hosted.custody.v1:${tenantId}:${businessId}`); }
    finally { key.fill(0); }
  }

  unwrapPassphrase(tenantId: string, businessId: string, sealed: Sealed): string {
    check(isTenantId(tenantId) && isBusinessId(businessId), 'CUSTODY_INVALID', 'Unknown tenant or business.');
    const key = this.#derive('chausar.hosted.tenant.v1', tenantId);
    try { return this.#open(key, sealed, `chausar.hosted.custody.v1:${tenantId}:${businessId}`).toString('utf8'); }
    finally { key.fill(0); }
  }

  /** The account directory (emails, passkeys, sessions, sealed vault keys) is sealed as one value. */
  sealDirectory(plaintext: Buffer): Sealed {
    const key = this.#derive('chausar.hosted.directory.v1');
    try { return this.#seal(key, plaintext, 'chausar.hosted.directory.v1'); }
    finally { key.fill(0); }
  }

  openDirectory(sealed: Sealed): Buffer {
    const key = this.#derive('chausar.hosted.directory.v1');
    try { return this.#open(key, sealed, 'chausar.hosted.directory.v1'); }
    finally { key.fill(0); }
  }

  /**
   * The bearer the app sends with each request: an HMAC of the session id, so it is never stored and can be handed
   * to the page again. It only works beside the session cookie, which the page can't read.
   */
  rendererKey(sessionId: string): string {
    const key = this.#derive('chausar.hosted.renderer-key.v1');
    try { return createHmac('sha256', key).update(sessionId, 'utf8').digest('base64url'); }
    finally { key.fill(0); }
  }

  sameRendererKey(sessionId: string, supplied: unknown): boolean {
    if (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
    const expected = Buffer.from(this.rendererKey(sessionId));
    const given = Buffer.from(supplied);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
