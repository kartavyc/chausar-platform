import { check } from '../contracts.ts';

/**
 * A minimal, read-only OLE Compound File Binary reader (MS-CFB): header, DIFAT, FAT, mini-FAT and
 * the directory, enough to read named root streams. Every chain is bounded, range-checked and
 * cycle-checked; anything malformed refuses with `WORKBOOK_CFB_INVALID`, anything oversized with
 * `WORKBOOK_LIMIT`. Nothing is written anywhere.
 */
export const CFB_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');
export const MAX_CFB_BYTES = 2.5 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 4096;
const ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff, MAXREGSECT = 0xfffffffa;
const BAD = 'WORKBOOK_CFB_INVALID';
type Entry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };
export function isCompoundFile(bytes: Uint8Array) { return bytes.length >= 8 && CFB_MAGIC.equals(Buffer.from(bytes.buffer, bytes.byteOffset, 8)); }

/** The root-level streams of a compound file, by exact name. Storages are not descended. */
export function readCompoundStreams(input: Uint8Array, wanted: readonly string[]): Map<string, Buffer> {
  check(input.byteLength <= MAX_CFB_BYTES, 'WORKBOOK_LIMIT', 'Encrypted workbooks may be at most 2.5 MiB.');
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  check(bytes.length >= 512 && isCompoundFile(bytes), BAD, 'The compound file header is missing or truncated.');
  const major = bytes.readUInt16LE(26), shift = bytes.readUInt16LE(30), miniShift = bytes.readUInt16LE(32);
  check(bytes.readUInt16LE(28) === 0xfffe && ((major === 3 && shift === 9) || (major === 4 && shift === 12)) && miniShift === 6, BAD, 'The compound file header is not a supported version.');
  const size = 1 << shift, header = Math.max(512, size); check(bytes.length >= header && (major === 3 || bytes.subarray(512, 4096).every(b => b === 0)), BAD, 'The compound file header is truncated.');
  const sectors = Math.ceil((bytes.length - header) / size), perSector = size / 4;
  const fatCount = bytes.readUInt32LE(44), firstDir = bytes.readUInt32LE(48), cutoff = bytes.readUInt32LE(56), firstMini = bytes.readUInt32LE(60), miniCount = bytes.readUInt32LE(64);
  let difatNext = bytes.readUInt32LE(68); const difatCount = bytes.readUInt32LE(72);
  check(cutoff === 4096 && (major === 4 || bytes.readUInt32LE(40) === 0), BAD, 'The compound file header is invalid.');
  check(fatCount >= 1 && fatCount <= sectors && difatCount <= sectors && miniCount <= sectors, 'WORKBOOK_LIMIT', 'The compound file declares too many sectors.');
  const sector = (n: number) => { check(n <= MAXREGSECT && n < sectors, BAD, 'A compound file sector is out of range.'); return bytes.subarray(header + n * size, Math.min(bytes.length, header + (n + 1) * size)); };
  // DIFAT: 109 header slots, then a chain of DIFAT sectors whose last slot links the next.
  const fatSectors: number[] = []; const take = (n: number) => { if (fatSectors.length < fatCount && n !== FREESECT) fatSectors.push(n); };
  for (let i = 0; i < 109; i++) take(bytes.readUInt32LE(76 + i * 4));
  const difatSeen = new Set<number>();
  for (let i = 0; i < difatCount; i++) {
    check(!difatSeen.has(difatNext), BAD, 'The compound file DIFAT chain loops.'); difatSeen.add(difatNext); const block = sector(difatNext); check(block.length === size, BAD, 'A DIFAT sector is truncated.');
    for (let j = 0; j < perSector - 1; j++) take(block.readUInt32LE(j * 4)); difatNext = block.readUInt32LE(size - 4);
  }
  check(fatSectors.length === fatCount && new Set(fatSectors).size === fatCount && (difatCount === 0 || difatNext === ENDOFCHAIN || difatNext === FREESECT), BAD, 'The compound file allocation table is incomplete.');
  const fat = new Uint32Array(fatCount * perSector);
  fatSectors.forEach((n, index) => { const block = sector(n); check(block.length === size, BAD, 'A FAT sector is truncated.'); for (let j = 0; j < perSector; j++) fat[index * perSector + j] = block.readUInt32LE(j * 4); });
  const chain = (start: number, table: Uint32Array, limit: number) => {
    const out: number[] = []; const seen = new Set<number>();
    for (let n = start; n !== ENDOFCHAIN;) {
      check(n < limit && n < table.length, BAD, 'A compound file chain points outside the file.'); check(!seen.has(n), BAD, 'A compound file chain loops.');
      seen.add(n); out.push(n); n = table[n];
    }
    return out;
  };
  const readChain = (start: number, length?: number) => {
    const list = start === ENDOFCHAIN && length === 0 ? [] : chain(start, fat, sectors);
    if (length !== undefined) check(list.length === Math.ceil(length / size), BAD, 'A compound file stream does not match its chain.');
    const data = Buffer.concat(list.map(sector)); check(length === undefined || data.length >= length, BAD, 'A compound file stream is truncated.'); return length === undefined ? data : data.subarray(0, length);
  };
  // Directory: 128-byte entries; the root entry carries the mini stream.
  const directory = readChain(firstDir); check(directory.length >= 128 && directory.length / 128 <= MAX_DIRECTORY_ENTRIES, directory.length < 128 ? BAD : 'WORKBOOK_LIMIT', 'The compound file directory is missing or too large.');
  const entries: Entry[] = [];
  for (let at = 0; at + 128 <= directory.length; at += 128) {
    const nameBytes = directory.readUInt16LE(at + 64), type = directory.readUInt8(at + 66);
    check([0, 1, 2, 5].includes(type) && nameBytes <= 64 && nameBytes % 2 === 0, BAD, 'A compound file directory entry is invalid.');
    const high = directory.readUInt32LE(at + 124); check(major === 3 || high === 0, 'WORKBOOK_LIMIT', 'A compound file stream is too large.');
    entries.push({ name: directory.subarray(at, at + Math.max(0, nameBytes - 2)).toString('utf16le'), type, left: directory.readUInt32LE(at + 68), right: directory.readUInt32LE(at + 72), child: directory.readUInt32LE(at + 76), start: directory.readUInt32LE(at + 116), size: directory.readUInt32LE(at + 120) });
  }
  const root = entries[0]; check(root.type === 5, BAD, 'The compound file has no root entry.');
  const found = new Map<string, Entry>(); const visited = new Set<number>(); const stack = [root.child];
  while (stack.length) {
    const id = stack.pop()!; if (id === FREESECT) continue;
    check(id > 0 && id < entries.length && !visited.has(id), BAD, 'The compound file directory tree is invalid.'); visited.add(id);
    const entry = entries[id]; check(entry.type === 1 || entry.type === 2, BAD, 'The compound file directory tree is invalid.');
    const key = entry.name.toUpperCase(); check(!found.has(key), BAD, 'The compound file repeats a stream name.'); found.set(key, entry); stack.push(entry.left, entry.right);
  }
  let mini: { stream: Buffer; table: Uint32Array } | undefined;
  const miniStream = () => {
    if (mini) return mini;
    check(root.size <= MAX_CFB_BYTES, 'WORKBOOK_LIMIT', 'The compound file mini stream is too large.');
    const raw = miniCount === 0 ? Buffer.alloc(0) : readChain(firstMini, miniCount * size);
    const table = new Uint32Array(raw.length / 4); for (let j = 0; j < table.length; j++) table[j] = raw.readUInt32LE(j * 4);
    return (mini = { stream: root.size === 0 ? Buffer.alloc(0) : readChain(root.start, root.size), table });
  };
  const streams = new Map<string, Buffer>();
  for (const name of wanted) {
    const entry = found.get(name.toUpperCase()); if (!entry || entry.type !== 2) continue;
    check(entry.size <= MAX_CFB_BYTES, 'WORKBOOK_LIMIT', 'A compound file stream is too large.');
    if (entry.size >= cutoff) { streams.set(name, readChain(entry.start, entry.size)); continue; }
    const { stream, table } = miniStream(); if (entry.size === 0) { streams.set(name, Buffer.alloc(0)); continue; }
    const list = chain(entry.start, table, Math.floor(stream.length / 64)); check(list.length === Math.ceil(entry.size / 64), BAD, 'A compound file mini stream does not match its chain.');
    streams.set(name, Buffer.concat(list.map(n => stream.subarray(n * 64, n * 64 + 64))).subarray(0, entry.size));
  }
  return streams;
}

