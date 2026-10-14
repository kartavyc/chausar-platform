/**
 * Desktop-held keys. The relay stores sealed approval intents it cannot read or forge; the backup store
 * holds wrapped vault backups it cannot open. Both use AES-256-GCM with a fresh 12-byte nonce and an AAD
 * that binds the account (and the decision or backup) so a blob cannot be moved to another meaning.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { check, ChausarError } from '../contracts.ts';
import type { SealedBlob } from './client.ts';

export const SEALED_FORMAT = 'chausar-relay-sealed-v1';
export type Decision = 'approve' | 'not-now';
export type IntentPlaintext = { v: 1; offerId: string; actionId: string; digest: string; decision: Decision; expiresAt: string };

export function newKey(): string { return randomBytes(32).toString('base64'); }
function key(value: string): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'base64') : Buffer.alloc(0);
  check(bytes.length === 32 && bytes.toString('base64') === value, 'HOSTED_KEY_INVALID', 'The stored key is damaged.');
  return bytes;
}
const intentAad = (accountId: string, decision: Decision) => Buffer.from(`${SEALED_FORMAT}|${accountId}|${decision}`);

/** Seals one approval intent. The ciphertext field carries the GCM tag after the encrypted bytes. */
export function sealIntent(sealingKey: string, accountId: string, intent: IntentPlaintext): SealedBlob {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(sealingKey), nonce);
  cipher.setAAD(intentAad(accountId, intent.decision));
  const body = Buffer.concat([cipher.update(JSON.stringify(intent), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { format: SEALED_FORMAT, nonce: nonce.toString('base64'), ciphertext: body.toString('base64') };
}
/** Opens a sealed intent released by the relay. Any wrong key, wrong account, wrong decision or flipped byte refuses. */
export function openIntent(sealingKey: string, accountId: string, decision: Decision, sealed: { nonce: string; ciphertext: string }): IntentPlaintext {
  const nonce = Buffer.from(sealed.nonce, 'base64'), raw = Buffer.from(sealed.ciphertext, 'base64');
  check(nonce.length === 12 && nonce.toString('base64') === sealed.nonce && raw.length >= 17 && raw.length <= 4096 && raw.toString('base64') === sealed.ciphertext,
    'SEALED_INVALID', 'The sealed approval is damaged.');
  let plain: string;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(sealingKey), nonce); decipher.setAAD(intentAad(accountId, decision));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    plain = Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString('utf8');
  } catch { throw new ChausarError('SEALED_INVALID', 'The sealed approval is damaged or was not made here.'); }
  let value: any; try { value = JSON.parse(plain); } catch { value = null; }
  check(value && typeof value === 'object' && Object.keys(value).sort().join(',') === 'actionId,decision,digest,expiresAt,offerId,v' && value.v === 1
    && typeof value.offerId === 'string' && typeof value.actionId === 'string' && typeof value.digest === 'string' && value.decision === decision
    && typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt)), 'SEALED_INVALID', 'The sealed approval is damaged.');
  return value as IntentPlaintext;
}

/** Wrapped backup: magic, nonce, tag, ciphertext. */
export const BACKUP_MAGIC = Buffer.from('CHSBK1\0\0', 'latin1');
const backupAad = (accountId: string, backupId: string) => Buffer.from(`chausar-backup-v1|${accountId}|${backupId}`);
export function wrapBackup(backupKey: string, accountId: string, backupId: string, inner: Uint8Array): Buffer {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(backupKey), nonce);
  cipher.setAAD(backupAad(accountId, backupId));
  const body = Buffer.concat([cipher.update(inner), cipher.final()]);
  return Buffer.concat([BACKUP_MAGIC, nonce, cipher.getAuthTag(), body]);
}
export function unwrapBackup(backupKey: string, accountId: string, backupId: string, wrapped: Uint8Array): Buffer {
  const bytes = Buffer.from(wrapped);
  check(bytes.length > 36 && bytes.subarray(0, 8).equals(BACKUP_MAGIC), 'HOSTED_BACKUP_INVALID', 'The downloaded file is not a Chausar backup.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(backupKey), bytes.subarray(8, 20)); decipher.setAAD(backupAad(accountId, backupId));
    decipher.setAuthTag(bytes.subarray(20, 36));
    return Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
  } catch { throw new ChausarError('BACKUP_KEY_MISMATCH', 'This backup cannot be opened with the backup key held here.'); }
}
