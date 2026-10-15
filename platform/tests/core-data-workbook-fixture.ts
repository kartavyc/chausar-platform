import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

/**
 * Independent fixture authoring for encrypted workbooks: a small XLSX ZIP, ECMA-376 agile
 * encryption and an OLE compound file writer. None of this calls the reader's code.
 */
function fixtureCRC(bytes: Buffer) { let value = -1; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ -1) >>> 0; }
export function zip(files: { name: string; text: string }[]) {
  const body: Buffer[] = []; const directory: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name); const bytes = Buffer.from(file.text); const packed = deflateRawSync(bytes); const crc = fixtureCRC(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(8, 10); record.writeUInt32LE(crc, 16); record.writeUInt32LE(packed.length, 20); record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE((0x81a4 * 65536) >>> 0, 38); record.writeUInt32LE(offset, 42);
    body.push(local, name, packed); directory.push(record, name); offset += local.length + name.length + packed.length;
  }
  const central = Buffer.concat(directory); const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(offset, 16); return Buffer.concat([...body, central, eocd]);
}
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const column = (index: number) => String.fromCharCode(65 + index);
/** A one-sheet XLSX whose cells are inline strings, so the sheet reads back exactly. */
export function xlsx(rows: string[][], sheet = 'Sales', filler = 0) {
  const data = rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`).join('');
  return zip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>' },
    { name: '_rels/.rels', text: '<Relationships><Relationship Id="book" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escape(sheet)}" sheetId="1" r:id="s1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="s1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', text: `<worksheet><sheetData>${data}</sheetData>${filler ? `<!--${randomBytes(filler).toString('hex')}-->` : ''}</worksheet>` },
  ]);
}

/** Writes a version 3 compound file (512-byte sectors) holding these root streams. */
export function compoundFile(streams: [string, Buffer][], options: { loopFat?: boolean } = {}) {
  const SS = 512, END = 0xfffffffe, FREE = 0xffffffff, FATSECT = 0xfffffffd;
  const pad = (b: Buffer, n: number) => Buffer.concat([b, Buffer.alloc((n - (b.length % n)) % n)]);
  const big = streams.filter(([, b]) => b.length >= 4096), small = streams.filter(([, b]) => b.length < 4096);
  const sectors: Buffer[] = []; const fat: number[] = [];
  const place = (data: Buffer) => { if (data.length === 0) return END; const start = sectors.length; const padded = pad(data, SS); for (let i = 0; i < padded.length / SS; i++) { sectors.push(padded.subarray(i * SS, (i + 1) * SS)); fat.push(i === padded.length / SS - 1 ? END : sectors.length); } return start; };
  const starts = new Map<string, number>(); const miniFat: number[] = []; const miniParts: Buffer[] = [];
  for (const [name, data] of small) { const start = miniParts.length; const padded = pad(data, 64); for (let i = 0; i < padded.length / 64; i++) { miniParts.push(padded.subarray(i * 64, (i + 1) * 64)); miniFat.push(i === padded.length / 64 - 1 ? END : miniParts.length); } starts.set(name, start); }
  for (const [name, data] of big) starts.set(name, place(data));
  const miniStream = Buffer.concat(miniParts); const miniStart = place(miniStream);
  const miniFatBytes = Buffer.alloc(miniFat.length * 4); miniFat.forEach((v, i) => miniFatBytes.writeUInt32LE(v, i * 4));
  const miniFatStart = miniFat.length ? place(miniFatBytes) : END; const miniFatSectors = Math.ceil(miniFatBytes.length / SS);
  const entry = (name: string, type: number, child: number, right: number, start: number, size: number) => {
    const e = Buffer.alloc(128); Buffer.from(name + '\0', 'utf16le').copy(e, 0); e.writeUInt16LE((name.length + 1) * 2, 64); e.writeUInt8(type, 66); e.writeUInt8(1, 67);
    e.writeUInt32LE(FREE, 68); e.writeUInt32LE(right, 72); e.writeUInt32LE(child, 76); e.writeUInt32LE(start, 116); e.writeUInt32LE(size, 120); return e;
  };
  const entries = [entry('Root Entry', 5, streams.length ? 1 : FREE, FREE, miniStart, miniStream.length), ...streams.map(([name, data], i) => entry(name, 2, FREE, i + 2 <= streams.length ? i + 2 : FREE, starts.get(name)!, data.length))];
  while (entries.length % 4) { const e = Buffer.alloc(128); e.writeUInt32LE(FREE, 68); e.writeUInt32LE(FREE, 72); e.writeUInt32LE(FREE, 76); entries.push(e); }
  const dirStart = place(Buffer.concat(entries));
  let fatCount = 1; while (fatCount * 128 < sectors.length + fatCount) fatCount++;
  const fatStart = sectors.length; for (let i = 0; i < fatCount; i++) { fat.push(FATSECT); sectors.push(Buffer.alloc(SS)); }
  if (options.loopFat) fat[dirStart] = dirStart;
  const fatBytes = Buffer.alloc(fatCount * SS, 0xff); fat.forEach((v, i) => fatBytes.writeUInt32LE(v, i * 4));
  for (let i = 0; i < fatCount; i++) sectors[fatStart + i] = fatBytes.subarray(i * SS, (i + 1) * SS);
  const header = Buffer.alloc(512); Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header); header.writeUInt16LE(0x3e, 24); header.writeUInt16LE(3, 26); header.writeUInt16LE(0xfffe, 28); header.writeUInt16LE(9, 30); header.writeUInt16LE(6, 32);
  header.writeUInt32LE(fatCount, 44); header.writeUInt32LE(dirStart, 48); header.writeUInt32LE(4096, 56); header.writeUInt32LE(miniFatStart, 60); header.writeUInt32LE(miniFatSectors, 64); header.writeUInt32LE(END, 68); header.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < fatCount ? fatStart + i : FREE, 76 + i * 4);
  return Buffer.concat([header, ...sectors]);
}

const NODE: Record<string, string> = { SHA1: 'sha1', SHA256: 'sha256', SHA384: 'sha384', SHA512: 'sha512' };
const pad16 = (b: Buffer) => Buffer.concat([b, Buffer.alloc((16 - (b.length % 16)) % 16)]);
/** ECMA-376 agile encryption of a package, wrapped in a compound file. */
export function encryptAgile(pkg: Buffer, password: string, options: { hash?: 'SHA1' | 'SHA256' | 'SHA384' | 'SHA512'; spinCount?: number; keyBits?: 128 | 256; tamper?: boolean; editXml?: (xml: string) => string } = {}) {
  const hashName = options.hash ?? 'SHA512', node = NODE[hashName], spinCount = options.spinCount ?? 1000, keyBits = options.keyBits ?? 256, keyBytes = keyBits / 8;
  const H = (...parts: Buffer[]) => { const h = createHash(node); for (const p of parts) h.update(p); return h.digest(); };
  const hashSize = H().length; const fit = (b: Buffer, n: number) => { const o = Buffer.alloc(n, 0x36); b.copy(o, 0, 0, Math.min(n, b.length)); return o; };
  const enc = (key: Buffer, iv: Buffer, data: Buffer) => { const c = createCipheriv(`aes-${keyBits}-cbc`, key, iv).setAutoPadding(false); return Buffer.concat([c.update(pad16(data)), c.final()]); };
  const keySalt = randomBytes(16), passSalt = randomBytes(16), secret = randomBytes(keyBytes);
  let h = H(passSalt, Buffer.from(password, 'utf16le')); for (let i = 0; i < spinCount; i++) { const it = Buffer.alloc(4); it.writeUInt32LE(i); h = H(it, h); }
  const derive = (block: string) => fit(H(h, Buffer.from(block, 'hex')), keyBytes);
  const verifier = randomBytes(16);
  const encryptedVerifierHashInput = enc(derive('fea7d2763b4b9e79'), passSalt, verifier), encryptedVerifierHashValue = enc(derive('d7aa0f6d3061344e'), passSalt, H(verifier)), encryptedKeyValue = enc(derive('146e0be7abacd0d6'), passSalt, secret);
  const segments: Buffer[] = []; for (let i = 0; i * 4096 < pkg.length; i++) { const it = Buffer.alloc(4); it.writeUInt32LE(i); segments.push(enc(secret, fit(H(keySalt, it), 16), pkg.subarray(i * 4096, (i + 1) * 4096))); }
  const size = Buffer.alloc(8); size.writeBigUInt64LE(BigInt(pkg.length)); const stream = Buffer.concat([size, ...segments]);
  const hmacKey = randomBytes(hashSize), hmacValue = createHmac(node, hmacKey).update(stream).digest();
  const encryptedHmacKey = enc(secret, fit(H(keySalt, Buffer.from('5fb2ad010cb9e1f6', 'hex')), 16), hmacKey), encryptedHmacValue = enc(secret, fit(H(keySalt, Buffer.from('a0677f02b22c8433', 'hex')), 16), hmacValue);
  if (options.tamper) stream[stream.length - 20] ^= 1;
  const common = `saltSize="16" blockSize="16" keyBits="${keyBits}" hashSize="${hashSize}" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="${hashName}"`;
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate"><keyData ${common} saltValue="${keySalt.toString('base64')}"/><dataIntegrity encryptedHmacKey="${encryptedHmacKey.toString('base64')}" encryptedHmacValue="${encryptedHmacValue.toString('base64')}"/><keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password"><p:encryptedKey spinCount="${spinCount}" ${common} saltValue="${passSalt.toString('base64')}" encryptedVerifierHashInput="${encryptedVerifierHashInput.toString('base64')}" encryptedVerifierHashValue="${encryptedVerifierHashValue.toString('base64')}" encryptedKeyValue="${encryptedKeyValue.toString('base64')}"/></keyEncryptor></keyEncryptors></encryption>`;
  const info = Buffer.concat([Buffer.from([4, 0, 4, 0, 0x40, 0, 0, 0]), Buffer.from(options.editXml ? options.editXml(xml) : xml)]);
  return compoundFile([['EncryptionInfo', info], ['EncryptedPackage', stream]]);
}
/** A Standard (CryptoAPI, version 3.2) EncryptionInfo header: enough to be recognised and refused. */
export function standardEncrypted() {
  const info = Buffer.alloc(8 + 32); info.writeUInt16LE(3, 0); info.writeUInt16LE(2, 2); info.writeUInt32LE(0x24, 4);
  return compoundFile([['EncryptionInfo', info], ['EncryptedPackage', Buffer.alloc(64)]]);
}
