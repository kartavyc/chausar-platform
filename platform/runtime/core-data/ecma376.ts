import { createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { check, ChausarError } from '../contracts.ts';
import { readCompoundStreams } from './cfb.ts';

/**
 * ECMA-376 / MS-OFFCRYPTO agile encryption (EncryptionInfo 4.4) for an encrypted XLSX: the OLE
 * container holds `EncryptionInfo` and `EncryptedPackage`. The password is used once to derive keys
 * and is never kept, logged or put in a message; buffers made from it are zeroed after use.
 * Standard (CryptoAPI) and RC4 encryption are refused.
 */
type Xml = { name: string; attributes: Record<string, string>; children: Xml[]; text: string };
export type XmlParser = (bytes: Uint8Array) => Xml;
const SPIN_LIMIT = 10_000_000;
const SEGMENT = 4096;
const HASHES: Record<string, { node: string; size: number }> = { SHA1: { node: 'sha1', size: 20 }, 'SHA-1': { node: 'sha1', size: 20 }, SHA256: { node: 'sha256', size: 32 }, 'SHA-256': { node: 'sha256', size: 32 }, SHA384: { node: 'sha384', size: 48 }, 'SHA-384': { node: 'sha384', size: 48 }, SHA512: { node: 'sha512', size: 64 }, 'SHA-512': { node: 'sha512', size: 64 } };
const BLOCK = { verifierInput: 'fea7d2763b4b9e79', verifierValue: 'd7aa0f6d3061344e', keyValue: '146e0be7abacd0d6', hmacKey: '5fb2ad010cb9e1f6', hmacValue: 'a0677f02b22c8433' } as const;
const PASSWORD_URI = 'http://schemas.microsoft.com/office/2006/keyEncryptor/password';
const INVALID = 'WORKBOOK_ENCRYPTION_INVALID';
const local = (name: string) => name.split(':').at(-1)!;
type Params = { salt: Buffer; blockSize: number; keyBytes: number; hash: { node: string; size: number } };

/** Validates a one-time workbook password without echoing it. */
export function checkWorkbookPassword(password: unknown): asserts password is string | undefined {
  check(password === undefined || (typeof password === 'string' && password.length >= 1 && password.length <= 255 && !/\p{Cs}/u.test(password)), 'WORKBOOK_PASSWORD_INVALID', 'Type the workbook password as it was given, up to 255 characters.');
}

function base64(value: string | undefined, max: number): Buffer {
  check(typeof value === 'string' && value.length > 0 && value.length <= Math.ceil(max / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), INVALID, 'The encryption descriptor holds an invalid value.');
  return Buffer.from(value, 'base64');
}
function params(node: Xml): Params {
  const a = node.attributes; const hash = HASHES[a.hashAlgorithm ?? ''];
  check(hash, 'WORKBOOK_ENCRYPTION_UNSUPPORTED', 'Only SHA-1, SHA-256, SHA-384 and SHA-512 workbook encryption is supported.');
  check(a.cipherAlgorithm === 'AES' && a.cipherChaining === 'ChainingModeCBC', 'WORKBOOK_ENCRYPTION_UNSUPPORTED', 'Only AES-CBC workbook encryption is supported.');
  check(['128', '192', '256'].includes(a.keyBits ?? '') && a.blockSize === '16' && a.saltSize === '16' && a.hashSize === String(hash.size), INVALID, 'The encryption descriptor sizes are invalid.');
  const salt = base64(a.saltValue, 16); check(salt.length === 16, INVALID, 'The encryption descriptor salt is invalid.');
  return { salt, blockSize: 16, keyBytes: Number(a.keyBits) / 8, hash };
}
const digest = (p: Params, ...parts: Buffer[]) => { const h = createHash(p.hash.node); for (const part of parts) h.update(part); return h.digest(); };
/** Truncate, or pad with 0x36, to the wanted length (MS-OFFCRYPTO 2.3.4.12). */
function fit(value: Buffer, length: number) { const out = Buffer.alloc(length, 0x36); value.copy(out, 0, 0, Math.min(length, value.length)); return out; }
function decrypt(keyBytes: number, key: Buffer, iv: Buffer, data: Buffer) {
  check(data.length > 0 && data.length % 16 === 0, INVALID, 'Encrypted workbook data is not whole cipher blocks.');
  const d = createDecipheriv(`aes-${keyBytes * 8}-cbc`, key, iv).setAutoPadding(false); return Buffer.concat([d.update(data), d.final()]);
}
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/** Reads the EncryptionInfo version and, for agile, its parsed descriptor. */
function descriptor(info: Buffer, parse: XmlParser) {
  check(info.length >= 8, INVALID, 'The workbook encryption header is truncated.');
  const major = info.readUInt16LE(0), minor = info.readUInt16LE(2);
  if (!(major === 4 && minor === 4)) {
    if ([2, 3, 4].includes(major) && minor === 2) throw new ChausarError('WORKBOOK_ENCRYPTION_UNSUPPORTED', 'This workbook uses older standard or RC4 encryption. Save it again in current Excel, or remove the password, then bring it again.');
    throw new ChausarError('WORKBOOK_ENCRYPTION_UNSUPPORTED', 'This workbook uses an encryption scheme that is not supported. Only current Excel password encryption can be opened.');
  }
  check(info.readUInt32LE(4) === 0x40 && info.length <= 64 * 1024, INVALID, 'The workbook encryption header is invalid.');
  const root = parse(info.subarray(8)); check(local(root.name) === 'encryption', INVALID, 'The workbook encryption descriptor is invalid.');
  const one = (parent: Xml, name: string) => { const list = parent.children.filter(n => local(n.name) === name); check(list.length === 1, INVALID, 'The workbook encryption descriptor is incomplete.'); return list[0]; };
  const keyData = one(root, 'keyData'), integrity = one(root, 'dataIntegrity'), encryptors = one(root, 'keyEncryptors');
  const password = encryptors.children.filter(n => local(n.name) === 'keyEncryptor' && n.attributes.uri === PASSWORD_URI);
  check(password.length === 1, 'WORKBOOK_ENCRYPTION_UNSUPPORTED', 'This workbook is not protected by a password.');
  const key = one(password[0], 'encryptedKey'); const spin = key.attributes.spinCount ?? '';
  check(/^(0|[1-9]\d{0,7})$/.test(spin) && Number(spin) <= SPIN_LIMIT, INVALID, 'The workbook password work factor is out of range.');
  return { keyData, integrity, key, spinCount: Number(spin) };
}

/**
 * Turns an encrypted workbook container into the plain package bytes. Throws `PASSWORD_REQUIRED`
 * when no password is given, `WRONG_PASSWORD` when it does not verify, and
 * `WORKBOOK_INTEGRITY_FAILED` when the package was altered.
 */
export function decryptWorkbook(container: Uint8Array, password: string | undefined, parse: XmlParser, maxPackage: number): Buffer {
  const streams = readCompoundStreams(container, ['EncryptionInfo', 'EncryptedPackage']);
  const info = streams.get('EncryptionInfo'), pkg = streams.get('EncryptedPackage');
  check(info || pkg, 'UNSUPPORTED_WORKBOOK', 'Only read-only XLSX ZIP workbooks are supported. Binary XLS, XLSB and PDF/OCR are unavailable.');
  check(info && pkg, INVALID, 'The encrypted workbook is missing its encryption streams.');
  const { keyData, integrity, key, spinCount } = descriptor(info, parse);
  const data = params(keyData), pass = params(key);
  check(pkg.length >= 8 + 16, INVALID, 'The encrypted workbook package is truncated.');
  const declared = pkg.readBigUInt64LE(0); check(declared <= BigInt(maxPackage), 'WORKBOOK_LIMIT', 'Workbooks may be at most 2 MiB compressed.');
  const size = Number(declared), body = pkg.subarray(8);
  check(body.length % 16 === 0 && body.length >= size && body.length < size + SEGMENT + 16, INVALID, 'The encrypted workbook package size disagrees with its header.');
  const verifierInput = base64(key.attributes.encryptedVerifierHashInput, 1024), verifierValue = base64(key.attributes.encryptedVerifierHashValue, 1024), keyValue = base64(key.attributes.encryptedKeyValue, 1024);
  const hmacKeyCipher = base64(integrity.attributes.encryptedHmacKey, 1024), hmacValueCipher = base64(integrity.attributes.encryptedHmacValue, 1024);
  checkWorkbookPassword(password);
  if (password === undefined) throw new ChausarError('PASSWORD_REQUIRED', 'This workbook has a password. Enter it to open the file once on this computer.');
  // H0 = H(salt + password as UTF-16LE); Hn = H(iterator + Hn-1); per-purpose keys from H(Hn + blockKey).
  const secret = Buffer.from(password, 'utf16le'); let h = digest(pass, pass.salt, secret); secret.fill(0);
  const round = Buffer.alloc(4 + pass.hash.size);
  for (let i = 0; i < spinCount; i++) { round.writeUInt32LE(i, 0); h.copy(round, 4); h.fill(0); h = digest(pass, round); }
  round.fill(0);
  const derive = (block: string) => { const full = digest(pass, h, Buffer.from(block, 'hex')); const out = fit(full, pass.keyBytes); full.fill(0); return out; };
  const kInput = derive(BLOCK.verifierInput), kValue = derive(BLOCK.verifierValue), kKey = derive(BLOCK.keyValue); h.fill(0);
  let intermediate: Buffer | undefined, hmacKey: Buffer | undefined;
  try {
    const input = decrypt(pass.keyBytes, kInput, pass.salt, verifierInput).subarray(0, 16);
    const expected = decrypt(pass.keyBytes, kValue, pass.salt, verifierValue);
    check(input.length === 16 && expected.length >= pass.hash.size, INVALID, 'The workbook password verifier is truncated.');
    const actual = digest(pass, input);
    if (!same(actual, expected.subarray(0, pass.hash.size))) throw new ChausarError('WRONG_PASSWORD', 'That password did not open the workbook.');
    const fullKey = decrypt(pass.keyBytes, kKey, pass.salt, keyValue); check(fullKey.length >= data.keyBytes, INVALID, 'The workbook key is truncated.');
    intermediate = Buffer.from(fullKey.subarray(0, data.keyBytes)); fullKey.fill(0);
    // Data integrity: HMAC over the whole EncryptedPackage stream, checked before decrypting it.
    const iv = (block: string) => fit(digest(data, data.salt, Buffer.from(block, 'hex')), data.blockSize);
    const keyPlain = decrypt(data.keyBytes, intermediate, iv(BLOCK.hmacKey), hmacKeyCipher), valuePlain = decrypt(data.keyBytes, intermediate, iv(BLOCK.hmacValue), hmacValueCipher);
    check(keyPlain.length >= data.hash.size && valuePlain.length >= data.hash.size, 'WORKBOOK_INTEGRITY_FAILED', 'The workbook failed its integrity check. It may be damaged or altered.');
    hmacKey = Buffer.from(keyPlain.subarray(0, data.hash.size)); keyPlain.fill(0);
    const mac = createHmac(data.hash.node, hmacKey).update(pkg).digest();
    check(same(mac, valuePlain.subarray(0, data.hash.size)), 'WORKBOOK_INTEGRITY_FAILED', 'The workbook failed its integrity check. It may be damaged or altered.');
    const out = Buffer.alloc(body.length);
    for (let index = 0, offset = 0; offset < body.length; index++, offset += SEGMENT) {
      const segment = body.subarray(offset, Math.min(body.length, offset + SEGMENT)); const counter = Buffer.alloc(4); counter.writeUInt32LE(index, 0);
      decrypt(data.keyBytes, intermediate, fit(digest(data, data.salt, counter), data.blockSize), segment).copy(out, offset);
    }
    return out.subarray(0, size);
  } finally { for (const buffer of [kInput, kValue, kKey, intermediate, hmacKey]) buffer?.fill(0); }
}
