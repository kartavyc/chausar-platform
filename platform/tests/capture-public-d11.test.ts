import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { encodePublicRecords, decodePublicRecords } from '../runtime/venture/replay/public-bytes.ts';
import { sealCanonical } from '../runtime/venture/journal/seal-json.ts';
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 17)]), type: 'pkcs8', format: 'der' });
function records() {
  const receipt = { id: 'receipt_sample', kind: 'venture-price-receipt', ventureId: 'sample', value: '100' };
  const key = { id: 'key_sample', kind: 'venture-signing-key', ventureId: 'sample', algorithm: 'ed25519', publicKey: createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64') };
  const signature = { kind: 'venture-receipt-signature', ventureId: 'sample', keyId: key.id, receiptId: receipt.id, receiptKind: receipt.kind, signature: sign(null, Buffer.from(sealCanonical(receipt)), privateKey).toString('base64') };
  return [receipt, key, signature];
}
test('only cryptographically verified public record bytes round trip', () => {
  const rows = records(); assert.deepEqual(decodePublicRecords(encodePublicRecords(rows)), rows);
  (rows[0] as any).value = '200';
  assert.throws(() => encodePublicRecords(rows), { code: 'CAPTURE_INVALID' });
});
test('a typed signature cannot hide arbitrary data or move into a secret field', () => {
  const rows = records(); (rows[2] as any).signature = Buffer.alloc(64, 19).toString('base64');
  assert.throws(() => encodePublicRecords(rows), { code: 'CAPTURE_INVALID' });
  assert.throws(() => decodePublicRecords({ apiKey: { capturePublic: 'ed25519-signature', bytes: Array(64).fill(19) } }), { code: 'CAPTURE_INVALID' });
});
