/** Public Ed25519 bytes only. This cannot encode credentials or arbitrary strings past the secret scanner. */
import { createPublicKey, verify } from 'node:crypto';
import { check } from '../../portable.ts';
import { sealCanonical } from '../journal/seal-json.ts';
type PublicBytes = { capturePublic: 'ed25519-spki' | 'ed25519-signature'; bytes: number[] };
const signatureBytes = (value: string) => /^[A-Za-z0-9+/]{86}==$/.test(value) && Buffer.from(value, 'base64').length === 64;
export function encodePublicRecords(value: unknown): unknown { verifyPublicRecords(value); return encode(value); }
function encode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encode);
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>, out = Object.fromEntries(Object.entries(row).map(([key, item]) => [key, encode(item)]));
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
export function decodePublicRecords(value: unknown): unknown { const decoded = decode(value); verifyPublicRecords(decoded); return decoded; }
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
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
    } else out[field] = decode(item);
  }
  return out;
}

function verifyPublicRecords(value: unknown) {
  const rows: Record<string, unknown>[] = [];
  const walk = (item: unknown) => {
    if (Array.isArray(item)) { item.forEach(walk); return; }
    if (!item || typeof item !== 'object') return;
    const row = item as Record<string, unknown>;
    if (typeof row.kind === 'string') rows.push(row);
    Object.values(row).forEach(walk);
  };
  walk(value);
  for (const signature of rows.filter(row => row.kind === 'venture-receipt-signature')) {
    const keys = rows.filter(row => row.kind === 'venture-signing-key' && row.id === signature.keyId && row.ventureId === signature.ventureId);
    const receipts = rows.filter(row => row.id === signature.receiptId && row.kind === signature.receiptKind && row.ventureId === signature.ventureId);
    let valid = false;
    try {
      if (keys.length === 1 && receipts.length === 1 && typeof keys[0]!.publicKey === 'string' && typeof signature.signature === 'string' && signatureBytes(signature.signature)) {
        const key = createPublicKey({ key: Buffer.from(keys[0]!.publicKey, 'base64'), type: 'spki', format: 'der' });
        valid = key.asymmetricKeyType === 'ed25519' && verify(null, Buffer.from(sealCanonical(receipts[0])), key, Buffer.from(signature.signature, 'base64'));
      }
    } catch { /* Invalid public records cannot be encoded past the scanner. */ }
    check(valid, 'CAPTURE_INVALID', 'A captured public signature must verify its exact receipt and public key.');
  }
}
