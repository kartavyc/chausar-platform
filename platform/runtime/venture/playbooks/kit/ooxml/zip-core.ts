// Original shared PKWARE ZIP directory, limits and CRC validation; native and browser readers use one policy.
import {ChausarError} from '../../../../portable.ts';
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
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function unreadable(): never {
  throw new ChausarError('OOXML_UNREADABLE', UNREADABLE);
}

/** Whether a name inside a zip stays inside it: relative, forward slashes, no '..' part, no drive or empty part. */
export function safeName(name: string): boolean {
  if (!name || name.length > 512 || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name) || /[\u0000-\u001f]/.test(name)) return false;
  return name.split('/').every((part, index, parts) => part !== '..' && part !== '.' && (part !== '' || index === parts.length - 1));
}


export type PackedEntry={name:string;packed:Uint8Array;method:number;plainSize:number;crc:number};
/** Inspect the bounded archive before allocating any decompressed entry. */
export function scanZip(input: Uint8Array, limits: { maxEntries?: number; maxBytes?: number } = {}): {entries: PackedEntry[]; count: number} {
  const maxEntries = limits.maxEntries ?? UNZIP_LIMITS.maxEntries, maxBytes = limits.maxBytes ?? UNZIP_LIMITS.maxBytes;
  const data = input;
  const view = new DataView(data.buffer,data.byteOffset,data.byteLength);
  if (data.length < 22) unreadable();
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 22 - 65_535); at--) {
    if (view.getUint32(at, true) === END) { end = at; break; }
  }
  if (end < 0) unreadable();
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (count > maxEntries || start + size > end) unreadable();
  const entries: PackedEntry[] = [];
  let total = 0, at = start;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL) unreadable();
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true);
    const packedSize = view.getUint32(at + 20, true), plainSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(data.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (flags & 0x0001 || packedSize === 0xffffffff || plainSize === 0xffffffff || localAt === 0xffffffff) unreadable();
    if (name.endsWith('/')) continue;
    if (!safeName(name) || (method !== 0 && method !== 8)) unreadable();
    total += plainSize;
    if (total > maxBytes) unreadable();
    if (localAt + 30 > data.length || view.getUint32(localAt, true) !== LOCAL) unreadable();
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (dataAt + packedSize > data.length) unreadable();
    const packed = data.subarray(dataAt, dataAt + packedSize);
    entries.push({name,packed,method,plainSize,crc});
  }
  return {entries,count};
}

/** Validate actual output length and integrity after decompression. */
export function verifiedEntry(entry:PackedEntry,bytes:Uint8Array):ZipEntry{if(bytes.length!==entry.plainSize||crc32(bytes)!==entry.crc)unreadable();return {name:entry.name,bytes:new Uint8Array(bytes)};}
