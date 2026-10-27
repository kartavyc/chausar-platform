// Chausar playbook kit (Ink v2 wave 5, package 5A5, P11): the smallest zip writer and reader DOCX and XLSX need, on
// node:zlib alone (no new dependency). The writer makes the same bytes for the same files: every entry is deflated, with
// one fixed date (1 Jan 1980), UTF-8 names and no extra fields. The reader takes what Word, Excel and LibreOffice write
// (stored or deflated entries, no encryption, no zip64) and refuses anything else, a damaged entry, a name that climbs
// out of its folder, and more than the bytes it was allowed, as OOXML_UNREADABLE in plain words. Written for Chausar
// from the published ZIP format (PKWARE APPNOTE); no code is learned from an outside source.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { ChausarError } from '../../../../contracts.ts';

/** One file in a zip: its path inside the zip (forward slashes) and its bytes. */
export type ZipEntry = { name: string; bytes: Uint8Array };

const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;
/** 1 Jan 1980, 00:00, as a zip stores a date: every entry carries it, so the bytes never depend on the clock. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8_NAMES = 0x0800;
/** What the reader opens by default: at most 2,000 entries and 64 MB unpacked. */
export const UNZIP_LIMITS = Object.freeze({ maxEntries: 2000, maxBytes: 64_000_000 });
const UNREADABLE = 'Chausar could not read this file as a Word or Excel document. Save it again from Word or Excel and add it once more.';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 a zip keeps for each entry. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function unreadable(): never {
  throw new ChausarError('OOXML_UNREADABLE', UNREADABLE);
}

/** Whether a name inside a zip stays inside it: relative, forward slashes, no '..' part, no drive or empty part. */
function safeName(name: string): boolean {
  if (!name || name.length > 512 || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name) || /[\u0000-\u001f]/.test(name)) return false;
  return name.split('/').every((part, index, parts) => part !== '..' && part !== '.' && (part !== '' || index === parts.length - 1));
}

/**
 * The zip of these files, in this order, every entry deflated. The same files give the same bytes. A name that is not
 * a safe relative path refuses (OOXML_INVALID): code names the parts, never a person.
 */
export function zip(files: readonly ZipEntry[]): Uint8Array {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    if (!safeName(file.name)) throw new ChausarError('OOXML_INVALID', 'A file inside the document has a name Chausar cannot use.');
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.bytes);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(UTF8_NAMES, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/**
 * Every entry of a zip, in the order its directory lists them (folders left out). Refuses (OOXML_UNREADABLE) what is
 * not a zip, an encrypted or zip64 entry, a method other than stored or deflated, an unsafe name, a CRC that does not
 * match, and more entries or unpacked bytes than the limits allow.
 */
export function unzip(input: Uint8Array, limits: { maxEntries?: number; maxBytes?: number } = {}): ZipEntry[] {
  const maxEntries = limits.maxEntries ?? UNZIP_LIMITS.maxEntries, maxBytes = limits.maxBytes ?? UNZIP_LIMITS.maxBytes;
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < 22) unreadable();
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 22 - 65_535); at--) {
    if (data.readUInt32LE(at) === END) { end = at; break; }
  }
  if (end < 0) unreadable();
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), start = data.readUInt32LE(end + 16);
  if (count > maxEntries || start + size > end) unreadable();
  const entries: ZipEntry[] = [];
  let total = 0, at = start;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || data.readUInt32LE(at) !== CENTRAL) unreadable();
    const flags = data.readUInt16LE(at + 8), method = data.readUInt16LE(at + 10), crc = data.readUInt32LE(at + 16);
    const packedSize = data.readUInt32LE(at + 20), plainSize = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28), extraLength = data.readUInt16LE(at + 30), commentLength = data.readUInt16LE(at + 32);
    const localAt = data.readUInt32LE(at + 42);
    const name = data.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;
    if (flags & 0x0001 || packedSize === 0xffffffff || plainSize === 0xffffffff || localAt === 0xffffffff) unreadable();
    if (name.endsWith('/')) continue;
    if (!safeName(name) || (method !== 0 && method !== 8)) unreadable();
    total += plainSize;
    if (total > maxBytes) unreadable();
    if (localAt + 30 > data.length || data.readUInt32LE(localAt) !== LOCAL) unreadable();
    const dataAt = localAt + 30 + data.readUInt16LE(localAt + 26) + data.readUInt16LE(localAt + 28);
    if (dataAt + packedSize > data.length) unreadable();
    const packed = data.subarray(dataAt, dataAt + packedSize);
    let bytes: Buffer;
    try { bytes = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: Math.max(1, plainSize) }); } catch { unreadable(); }
    if (bytes.length !== plainSize || crc32(bytes) !== crc) unreadable();
    entries.push({ name, bytes: new Uint8Array(bytes) });
  }
  return entries;
}
