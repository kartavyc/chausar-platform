import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkbook } from '../runtime/workbook.ts';
import { compoundFile, encryptAgile, standardEncrypted, xlsx } from './core-data-workbook-fixture.ts';

const password = 'Fixture-workbook-pässword-2026';
const rows = [['Invoice', 'Amount'], ['I-001', '1250.25'], ['ACME & Sons', '0.01']];
const refuses = (code: string) => (error: any) => { assert.equal(error?.code, code); assert.ok(!String(error.message).includes(password)); return true; };

test('an agile-encrypted workbook reads exactly like its plain package with the right password', () => {
  const plain = readWorkbook(xlsx(rows));
  for (const hash of ['SHA512', 'SHA256', 'SHA1'] as const) for (const keyBits of [256, 128] as const) {
    const encrypted = readWorkbook(encryptAgile(xlsx(rows), password, { hash, keyBits }), { password });
    assert.deepEqual(encrypted, plain); assert.deepEqual(encrypted.sheets[0].rows, rows);
  }
  // A package larger than one 4096-byte segment and the mini-stream cutoff uses regular sectors and per-segment IVs.
  const large = xlsx(rows, 'Sales', 12000); assert.ok(large.length > 2 * 4096);
  assert.deepEqual(readWorkbook(encryptAgile(large, password), { password, sheet: 'Sales' }).sheets[0].rows, rows);
});

test('a missing password asks for one; a wrong one is refused without echoing it', () => {
  const file = encryptAgile(xlsx(rows), password);
  assert.throws(() => readWorkbook(file), refuses('PASSWORD_REQUIRED'));
  assert.throws(() => readWorkbook(file, { sheet: 'Sales' }), refuses('PASSWORD_REQUIRED'));
  assert.throws(() => readWorkbook(file, { password: password.toUpperCase() }), refuses('WRONG_PASSWORD'));
  assert.throws(() => readWorkbook(file, { password: 'x' }), refuses('WRONG_PASSWORD'));
  for (const bad of ['', 'a'.repeat(256), 42, '\ud800'] as any[]) assert.throws(() => readWorkbook(file, { password: bad }), refuses('WORKBOOK_PASSWORD_INVALID'));
  // A password given for a plain workbook is not needed and changes nothing.
  assert.deepEqual(readWorkbook(xlsx(rows), { password }).sheets[0].rows, rows);
});

test('a tampered encrypted package fails its integrity check before it is read', () => {
  assert.throws(() => readWorkbook(encryptAgile(xlsx(rows), password, { tamper: true }), { password }), refuses('WORKBOOK_INTEGRITY_FAILED'));
});

test('malformed or oversized compound files are refused with typed codes', () => {
  const good = encryptAgile(xlsx(rows), password);
  assert.throws(() => readWorkbook(good.subarray(0, 300), { password }), refuses('WORKBOOK_CFB_INVALID'));
  const short = Buffer.alloc(22); Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(short); assert.throws(() => readWorkbook(short), refuses('WORKBOOK_CFB_INVALID'));
  assert.throws(() => readWorkbook(compoundFile([['EncryptionInfo', Buffer.alloc(16)], ['EncryptedPackage', Buffer.alloc(64)]], { loopFat: true }), { password }), refuses('WORKBOOK_CFB_INVALID'));
  const badVersion = Buffer.from(good); badVersion.writeUInt16LE(5, 26); assert.throws(() => readWorkbook(badVersion, { password }), refuses('WORKBOOK_CFB_INVALID'));
  const outOfRange = Buffer.from(good); outOfRange.writeUInt32LE(100000, 48); assert.throws(() => readWorkbook(outOfRange, { password }), refuses('WORKBOOK_CFB_INVALID'));
  const tooManyFat = Buffer.from(good); tooManyFat.writeUInt32LE(1_000_000, 44); assert.throws(() => readWorkbook(tooManyFat, { password }), refuses('WORKBOOK_LIMIT'));
  const truncated = good.subarray(0, good.length - 512); assert.throws(() => readWorkbook(truncated, { password }), (error: any) => ['WORKBOOK_CFB_INVALID'].includes(error.code));
  const huge = Buffer.alloc(3 * 1024 * 1024); good.copy(huge); assert.throws(() => readWorkbook(huge, { password }), refuses('WORKBOOK_LIMIT'));
  // A compound file without encryption streams is binary XLS, refused as before.
  assert.throws(() => readWorkbook(compoundFile([['Workbook', Buffer.alloc(5000)]])), refuses('UNSUPPORTED_WORKBOOK'));
  assert.throws(() => readWorkbook(compoundFile([['EncryptionInfo', Buffer.alloc(16)]]), { password }), refuses('WORKBOOK_ENCRYPTION_INVALID'));
});

test('standard, extensible and unknown encryption versions are refused as unsupported, even without a password', () => {
  assert.throws(() => readWorkbook(standardEncrypted()), refuses('WORKBOOK_ENCRYPTION_UNSUPPORTED'));
  assert.throws(() => readWorkbook(standardEncrypted(), { password }), refuses('WORKBOOK_ENCRYPTION_UNSUPPORTED'));
  for (const [major, minor] of [[4, 3], [1, 1], [9, 9]]) {
    const info = Buffer.alloc(40); info.writeUInt16LE(major, 0); info.writeUInt16LE(minor, 2);
    assert.throws(() => readWorkbook(compoundFile([['EncryptionInfo', info], ['EncryptedPackage', Buffer.alloc(64)]]), { password }), refuses('WORKBOOK_ENCRYPTION_UNSUPPORTED'));
  }
});

test('the agile descriptor is parsed strictly and its work factor is bounded', () => {
  const variants: [(xml: string) => string, string][] = [
    [xml => xml.replace('spinCount="1000"', 'spinCount="10000001"'), 'WORKBOOK_ENCRYPTION_INVALID'],
    [xml => xml.replaceAll('ChainingModeCBC', 'ChainingModeCFB'), 'WORKBOOK_ENCRYPTION_UNSUPPORTED'],
    [xml => xml.replaceAll('hashAlgorithm="SHA512"', 'hashAlgorithm="MD5"'), 'WORKBOOK_ENCRYPTION_UNSUPPORTED'],
    [xml => xml.replaceAll('cipherAlgorithm="AES"', 'cipherAlgorithm="DES"'), 'WORKBOOK_ENCRYPTION_UNSUPPORTED'],
    [xml => xml.replace(/<dataIntegrity [^>]*\/>/, ''), 'WORKBOOK_ENCRYPTION_INVALID'],
    [xml => xml.replace('keyEncryptor/password">', 'keyEncryptor/certificate">'), 'WORKBOOK_ENCRYPTION_UNSUPPORTED'],
    [xml => xml.replaceAll('keyBits="256"', 'keyBits="512"'), 'WORKBOOK_ENCRYPTION_INVALID'],
    [xml => xml.replace(/saltValue="[^"]*"/, 'saltValue="AAAA"'), 'WORKBOOK_ENCRYPTION_INVALID'],
    [xml => xml.replace('<encryption ', '<!DOCTYPE x [<!ENTITY e "x">]><encryption '), 'UNSUPPORTED_XML_ENTITY'],
    [xml => xml.replace('</encryption>', ''), 'INVALID_OPENXML'],
  ];
  for (const [editXml, code] of variants) assert.throws(() => readWorkbook(encryptAgile(xlsx(rows), password, { editXml }), { password }), refuses(code));
  // A small work factor is still checked against the verifier.
  assert.deepEqual(readWorkbook(encryptAgile(xlsx(rows), password, { spinCount: 0 }), { password }).sheets[0].rows, rows);
});
