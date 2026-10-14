import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { check } from './errors.ts';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Message links and buttons carry no digit, so a message body never does. 48 letters carry about 273 bits. */
export function letterToken(length = 48): string {
  let out = '';
  while (out.length < length) for (const byte of randomBytes(length * 2)) { if (byte < 208 && out.length < length) out += LETTERS[byte % 52]; }
  return out;
}
export const isLetterToken = (value: unknown, length = 48): value is string => typeof value === 'string' && value.length === length && /^[A-Za-z]+$/.test(value);
export const opaqueToken = () => randomBytes(32).toString('base64url');
export const isOpaqueToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
export const isId = (value: unknown, prefix?: string): value is string => typeof value === 'string' && value.length <= 128
  && (prefix ? new RegExp(`^${prefix}_[0-9a-f-]{36}$`).test(value) : /^[A-Za-z0-9_-]{1,128}$/.test(value));
/** Only keyed hashes of bearer secrets are stored. */
export function secretHash(pepper: string, purpose: string, secret: string): string {
  check(typeof pepper === 'string' && pepper.length >= 32, 'SERVER_MISCONFIGURED', 'The server secret is missing or too short.', 500);
  return createHmac('sha256', pepper).update(`${purpose}\0${secret}`).digest('hex');
}
export function hmacHex(key: string | Buffer, data: string | Buffer): string { return createHmac('sha256', key).update(data).digest('hex'); }
export function sameHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]*$/i.test(a + b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
export function sameText(a: string, b: string): boolean {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Server-side sealing for secrets the server must use later (for example a Telegram chat binding). */
export function sealServer(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
export function openServer(key: Buffer, sealed: string, aad: string): string {
  const raw = Buffer.from(sealed, 'base64'); check(raw.length >= 28, 'SEALED_INVALID', 'A sealed server value is damaged.', 500);
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(raw.subarray(12, 28));
  try { return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'); }
  catch { throw new Error('SEALED_INVALID'); }
}
