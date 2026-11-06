/** Public Ed25519 bytes only. This cannot encode credentials or arbitrary strings past the secret scanner. */
import { createPublicKey } from 'node:crypto';
import { check } from '../../portable.ts';
type PublicBytes = { capturePublic: 'ed25519-spki' | 'ed25519-signature'; bytes: number[] };
const signatureBytes = (value: string) => /^[A-Za-z0-9+/]{86}==$/.test(value) && Buffer.from(value, 'base64').length === 64;
export function encodePublicRecords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encodePublicRecords);
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>, out = Object.fromEntries(Object.entries(row).map(([key, item]) => [key, encodePublicRecords(item)]));
  if (row.kind === 'venture-signing-key' && row.algorithm === 'ed25519' && typeof row.publicKey === 'string') {
    try {
      const bytes = Buffer.from(row.publicKey, 'base64'), key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
      if (key.asymmetricKeyType === 'ed25519' && key.export({ format: 'der', type: 'spki' }).equals(bytes)) out.publicKey = { capturePublic: 'ed25519-spki', bytes: [...bytes] } satisfies PublicBytes;
    } catch { /* Invalid public material remains text and is subject to the ordinary scanner. */ }
  }
  if (row.kind === 'venture-receipt-signature' && typeof row.signature === 'string' && signatureBytes(row.signature))
    out.signature = { capturePublic: 'ed25519-signature', bytes: [...Buffer.from(row.signature, 'base64')] } satisfies PublicBytes;
  return out;
}
export function decodePublicRecords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodePublicRecords);
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const [field, item] of Object.entries(row)) {
    if (item && typeof item === 'object' && 'capturePublic' in item) {
      const bytes = item as PublicBytes;
      const allowed = field === 'publicKey' && row.kind === 'venture-signing-key' && row.algorithm === 'ed25519' && bytes.capturePublic === 'ed25519-spki'
        || field === 'signature' && row.kind === 'venture-receipt-signature' && bytes.capturePublic === 'ed25519-signature';
      check(allowed && Object.keys(bytes).length === 2 && Array.isArray(bytes.bytes) && bytes.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255), 'CAPTURE_INVALID', 'Public capture bytes have an invalid schema.');
      const buffer = Buffer.from(bytes.bytes), text = buffer.toString('base64');
      if (field === 'signature') check(signatureBytes(text), 'CAPTURE_INVALID', 'The captured signature is invalid.');
      else { const key = createPublicKey({ key: buffer, format: 'der', type: 'spki' }); check(key.asymmetricKeyType === 'ed25519' && key.export({ format: 'der', type: 'spki' }).equals(buffer), 'CAPTURE_INVALID', 'The captured public key is invalid.'); }
      out[field] = text;
    } else out[field] = decodePublicRecords(item);
  }
  return out;
}
