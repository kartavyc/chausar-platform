import test from 'node:test';
import assert from 'node:assert/strict';
test('sample PDF operation encoding refuses encoded secrets and arbitrary byte fields', async () => {
  const { encodeOperation, decodeOperation } = await import('../runtime/venture/replay/operation.ts');
  const key = ['sk', 'ant', 'api03', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz3'].join('-');
  assert.throws(() => encodeOperation('venture.about.read', { attachment: { name: 'sample.pdf', kind: 'resume-pdf', contentBase64: Buffer.from('%PDF-1.4\n' + key + '\n%%EOF').toString('base64') } }), { code: 'CAPTURE_REFUSED' });
  assert.throws(() => decodeOperation({ method: 'venture.client.add', payload: { apiKey: { samplePdfText: 'arbitrary' } } }), { code: 'CAPTURE_INVALID' });
});
