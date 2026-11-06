// Existing Chausar mailbox-test certificate recipe, scoped to a temporary form fixture. No key is committed.
import {generateKeyPairSync,sign} from 'node:crypto';
/** A DER element: its tag, its length and its contents. */
function der(tag, ...parts) {
  const body = Buffer.concat(parts);
  const size = [];
  for (let n = body.length; n > 0; n = Math.floor(n / 256)) size.unshift(n % 256);
  const length = body.length < 0x80 ? Buffer.from([body.length]) : Buffer.from([0x80 | size.length, ...size]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
}
function oid(dotted) {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [40 * a + b];
  for (const n of rest) {
    const part = [n % 128];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) part.unshift((v % 128) | 0x80);
    bytes.push(...part);
  }
  return der(0x06, Buffer.from(bytes));
}
/** A self-signed certificate for "records.example.com", made at runtime (no key or certificate is kept in the repository). */
export function formsTestCertificate() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const algorithm = der(0x30, oid('1.2.840.10045.4.3.2'));
  const name = der(0x30, der(0x31, der(0x30, oid('2.5.4.3'), der(0x0c, Buffer.from('records.example.com')))));
  const time = (ms) => der(0x17, Buffer.from(`${new Date(ms).toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`));
  const tbs = der(0x30, der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, Buffer.from([1])), algorithm, name,
    der(0x30, time(Date.now() - 86_400_000), time(Date.now() + 86_400_000)), name, publicKey.export({ type: 'spki', format: 'der' }));
  const cert = der(0x30, tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), sign('sha256', tbs, privateKey)])));
  const begin = ['-----BEGIN', 'CERTIFICATE-----'].join(' ');
  const end = ['-----END', 'CERTIFICATE-----'].join(' ');
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: `${begin}\n${cert.toString('base64').match(/.{1,64}/g).join('\n')}\n${end}\n` };
}
