import { constants } from 'node:fs';
import { mkdir, open, lstat, type FileHandle } from 'node:fs/promises';
import { crc32, inflateRawSync } from 'node:zlib';
import { join, posix } from 'node:path';
import { check } from '../contracts.ts';

/**
 * A small ZIP reader for verified release archives, so a zip artifact unpacks on every platform
 * without an external tool. It reads the central directory, supports stored and deflate entries,
 * checks every CRC-32 and size, and refuses zip64, encryption, links, absolute or parent paths,
 * duplicate names and anything over its caps. Files are written with owner permissions only
 * (executable bits kept), into a directory the caller has just created empty.
 */
export type ZipLimits = { maxEntries:number; maxEntryBytes:number; maxTotalBytes:number; maxRatio:number };
export const DEFAULT_ZIP_LIMITS:ZipLimits = Object.freeze({ maxEntries: 200000, maxEntryBytes: 1024 ** 3, maxTotalBytes: 4 * 1024 ** 3, maxRatio: 1000 });
export type ZipEntry = Readonly<{ name:string; directory:boolean; method:0|8; crc:number; compressedSize:number; size:number; localOffset:number; mode:number }>;

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50, ZIP64_LOCATOR = 0x07064b50;
const S_IFMT = 0o170000, S_IFLNK = 0o120000, S_IFDIR = 0o040000, S_IFREG = 0o100000;
const unsafe = (message:string) => check(false, 'INSTALL_UNSAFE_CONTENT', message);

async function readAt(file:FileHandle, position:number, length:number):Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
    check(bytesRead > 0, 'INSTALL_UNPACK_FAILED', 'The release archive is truncated.');
    offset += bytesRead;
  }
  return buffer;
}
/** Validates one entry name: relative POSIX segments only, no drive letters, backslashes, `.` or `..`. */
export function safeZipName(raw:Buffer, utf8:boolean):{ name:string; directory:boolean } {
  const name = utf8 ? new TextDecoder('utf-8', { fatal: true }).decode(raw) : raw.toString('latin1');
  check(name.length > 0 && name.length <= 1024 && !/[\x00-\x1f\x7f\\:]/.test(name), 'INSTALL_UNSAFE_CONTENT', 'A release archive entry has an unsafe name.');
  check(!name.startsWith('/'), 'INSTALL_UNSAFE_CONTENT', 'A release archive entry has an absolute path.');
  const directory = name.endsWith('/'), parts = (directory ? name.slice(0, -1) : name).split('/');
  check(parts.every(part => part !== '' && part !== '.' && part !== '..'), 'INSTALL_UNSAFE_CONTENT', 'A release archive entry leaves its directory.');
  return { name: parts.join('/'), directory };
}
/** Reads and checks the central directory. Nothing is written. */
export async function readZipDirectory(path:string, limits:ZipLimits = DEFAULT_ZIP_LIMITS):Promise<ZipEntry[]> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try { return await directoryOf(file, limits); } finally { await file.close(); }
}
async function directoryOf(file:FileHandle, limits:ZipLimits):Promise<ZipEntry[]> {
  const stat = await file.stat();
  check(stat.isFile() && stat.size >= 22, 'INSTALL_UNPACK_FAILED', 'The release archive is not a zip file.');
  const tailLength = Math.min(stat.size, 22 + 0xffff), tailStart = stat.size - tailLength, tail = await readAt(file, tailStart, tailLength);
  let end = -1;
  for (let index = tail.length - 22; index >= 0; index--) if (tail.readUInt32LE(index) === EOCD && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { end = index; break; }
  check(end >= 0, 'INSTALL_UNPACK_FAILED', 'The release archive has no zip directory.');
  if (end >= 20 && tail.readUInt32LE(end - 20) === ZIP64_LOCATOR) unsafe('Zip64 release archives are not accepted.');
  const disk = tail.readUInt16LE(end + 4), startDisk = tail.readUInt16LE(end + 6), onDisk = tail.readUInt16LE(end + 8), count = tail.readUInt16LE(end + 10);
  const size = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) unsafe('Zip64 release archives are not accepted.');
  check(disk === 0 && startDisk === 0 && onDisk === count, 'INSTALL_UNSAFE_CONTENT', 'Multi-part zip archives are not accepted.');
  check(count <= limits.maxEntries, 'INSTALL_UNSAFE_CONTENT', 'The release archive holds too many entries.');
  check(offset + size <= tailStart + end && size <= 64 * 1024 * 1024, 'INSTALL_UNPACK_FAILED', 'The zip directory is out of bounds.');
  const central = await readAt(file, offset, size), entries:ZipEntry[] = [], names = new Set<string>();
  let cursor = 0, total = 0;
  for (let index = 0; index < count; index++) {
    check(cursor + 46 <= central.length && central.readUInt32LE(cursor) === CENTRAL, 'INSTALL_UNPACK_FAILED', 'The zip directory is damaged.');
    const madeBy = central.readUInt16LE(cursor + 4) >> 8, flags = central.readUInt16LE(cursor + 8), method = central.readUInt16LE(cursor + 10);
    const crc = central.readUInt32LE(cursor + 16), compressedSize = central.readUInt32LE(cursor + 20), uncompressed = central.readUInt32LE(cursor + 24);
    const nameLength = central.readUInt16LE(cursor + 28), extraLength = central.readUInt16LE(cursor + 30), commentLength = central.readUInt16LE(cursor + 32);
    const entryDisk = central.readUInt16LE(cursor + 34), external = central.readUInt32LE(cursor + 38), localOffset = central.readUInt32LE(cursor + 42);
    check(cursor + 46 + nameLength + extraLength + commentLength <= central.length, 'INSTALL_UNPACK_FAILED', 'The zip directory is damaged.');
    if (flags & 0x41) unsafe('Encrypted release archive entries are not accepted.');
    if (compressedSize === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) unsafe('Zip64 release archives are not accepted.');
    check(entryDisk === 0, 'INSTALL_UNSAFE_CONTENT', 'Multi-part zip archives are not accepted.');
    check(method === 0 || method === 8, 'INSTALL_UNPACK_FAILED', 'A release archive entry uses an unsupported compression method.');
    const { name, directory } = safeZipName(central.subarray(cursor + 46, cursor + 46 + nameLength), (flags & 0x800) !== 0);
    // Unix (3) and macOS (19) record the file type in the high half of the external attributes.
    const unixMode = madeBy === 3 || madeBy === 19 ? external >>> 16 : 0, type = unixMode & S_IFMT;
    if (type === S_IFLNK) unsafe('The release archive holds a link.');
    check(type === 0 || type === S_IFREG || type === S_IFDIR, 'INSTALL_UNSAFE_CONTENT', 'The release archive holds a special file.');
    const isDirectory = directory || type === S_IFDIR;
    check(!isDirectory || uncompressed === 0, 'INSTALL_UNSAFE_CONTENT', 'A directory entry holds data.');
    const key = process.platform === 'win32' || process.platform === 'darwin' ? name.toLowerCase() : name;
    check(!names.has(key), 'INSTALL_UNSAFE_CONTENT', 'The release archive names one file twice.');
    names.add(key);
    check(uncompressed <= limits.maxEntryBytes && (total += uncompressed) <= limits.maxTotalBytes, 'INSTALL_UNSAFE_CONTENT', 'The release archive is larger than allowed.');
    check(uncompressed <= Math.max(compressedSize, 1) * limits.maxRatio, 'INSTALL_UNSAFE_CONTENT', 'A release archive entry expands too far.');
    check(method !== 0 || compressedSize === uncompressed, 'INSTALL_UNPACK_FAILED', 'A stored release archive entry has inconsistent sizes.');
    check(localOffset + 30 + compressedSize <= offset, 'INSTALL_UNPACK_FAILED', 'A release archive entry is out of bounds.');
    entries.push(Object.freeze({ name, directory: isDirectory, method: method as 0|8, crc, compressedSize, size: uncompressed, localOffset, mode: unixMode & 0o777 }));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  // A file and a directory with the same parent path, or a file used as a parent, would collide on disk.
  const files = new Set(entries.filter(entry => !entry.directory).map(entry => entry.name));
  for (const entry of entries) for (let parent = posix.dirname(entry.name); parent !== '.'; parent = posix.dirname(parent))
    check(!files.has(parent), 'INSTALL_UNSAFE_CONTENT', 'A release archive entry uses a file as its folder.');
  return entries;
}
/** Extracts every entry of a zip into `destination`, which must be an existing, empty, private directory. */
export async function unzipArchive(path:string, destination:string, limits:ZipLimits = DEFAULT_ZIP_LIMITS):Promise<{ files:number; bytes:number }> {
  const target = await lstat(destination);
  check(target.isDirectory() && !target.isSymbolicLink(), 'UNSAFE_UPDATE_PATH', 'Unpack into a real private directory.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let files = 0, bytes = 0;
  try {
    const entries = await directoryOf(file, limits);
    for (const entry of entries) {
      const output = join(destination, ...entry.name.split('/'));
      if (entry.directory) { await mkdir(output, { recursive: true, mode: 0o700 }); continue; }
      const local = await readAt(file, entry.localOffset, 30);
      check(local.readUInt32LE(0) === LOCAL, 'INSTALL_UNPACK_FAILED', 'A release archive entry is damaged.');
      const localFlags = local.readUInt16LE(6), localMethod = local.readUInt16LE(8), nameLength = local.readUInt16LE(26), extraLength = local.readUInt16LE(28);
      check(!(localFlags & 0x41) && localMethod === entry.method, 'INSTALL_UNPACK_FAILED', 'A release archive entry differs from its directory record.');
      const localName = await readAt(file, entry.localOffset + 30, nameLength);
      check(safeZipName(localName, (localFlags & 0x800) !== 0).name === entry.name, 'INSTALL_UNPACK_FAILED', 'A release archive entry differs from its directory record.');
      const compressed = await readAt(file, entry.localOffset + 30 + nameLength + extraLength, entry.compressedSize);
      let data:Buffer;
      try { data = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(entry.size, 1) }); }
      catch { check(false, 'INSTALL_UNPACK_FAILED', 'A release archive entry could not be decompressed.'); }
      check(data.length === entry.size && crc32(data) === entry.crc, 'INSTALL_UNPACK_FAILED', 'A release archive entry failed its checksum.');
      await mkdir(join(output, '..'), { recursive: true, mode: 0o700 });
      const handle = await open(output, 'wx', entry.mode & 0o111 ? 0o700 : 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      files++; bytes += data.length;
    }
  } finally { await file.close(); }
  return { files, bytes };
}
