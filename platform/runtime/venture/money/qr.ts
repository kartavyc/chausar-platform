// Wave 6 money (6D2): a QR code drawn by code, for an invoice's UPI link. Byte mode, error correction level M, versions 1
// to 10 (up to 213 bytes, far more than a UPI link needs). Written for Chausar from the QR code standard (ISO/IEC 18004):
// Reed-Solomon over GF(256) with the polynomial 0x11D, the fixed patterns, the zigzag codeword order, the eight masks
// scored by the standard's four penalty rules, and the BCH-coded format and version bits. Pure code, no dependency.
import type { QrMatrix } from './billing-types.ts';

/** Error correction codewords per block and number of blocks at level M, by version (index 0 unused). */
const ECC_PER_BLOCK_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;
/** Level M's two format bits. */
const ECC_FORMAT_M = 0;

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK_M[version]! * BLOCKS_M[version]!;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, index) => { result[index] = result[index]! ^ gfMultiply(coefficient, factor); });
  }
  return result;
}

/** The data codewords: mode, count, bytes, terminator, padding. */
function encodeData(bytes: readonly number[], version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  return codewords;
}

/** Splits the data into blocks, adds each block's error correction, and interleaves them. */
function withErrorCorrection(data: readonly number[], version: number): number[] {
  const blocks = BLOCKS_M[version]!, ecc = ECC_PER_BLOCK_M[version]!;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = rsDivisor(ecc);
  const made: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const take = shortLength - ecc + (i < shortBlocks ? 0 : 1);
    const part = data.slice(k, k + take);
    k += take;
    const block = [...part, ...rsRemainder(part, divisor)];
    if (i < shortBlocks) block.splice(shortLength - ecc, 0, 0);
    made.push(block);
  }
  const result: number[] = [];
  for (let i = 0; i < made[0]!.length; i++) {
    made.forEach((block, index) => { if (i !== shortLength - ecc || index >= shortBlocks) result.push(block[i]!); });
  }
  return result;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = version * 4 + 17 - 7; result.length < count; position -= step) result.splice(1, 0, position);
  return result;
}

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
  readonly version: number;
  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  set(x: number, y: number, dark: boolean) { this.dark[y]![x] = dark; this.fixed[y]![x] = true; }
}

function drawFunctionPatterns(grid: Grid): void {
  const { size } = grid;
  for (let i = 0; i < size; i++) { grid.set(6, i, i % 2 === 0); grid.set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) grid.set(x, y, distance !== 2 && distance !== 4);
    }
  }
  const positions = alignmentPositions(grid.version);
  const last = positions.length - 1;
  positions.forEach((x, i) => positions.forEach((y, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) grid.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  drawFormatBits(grid, 0);
  if (grid.version >= 7) {
    let remainder = grid.version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (grid.version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      grid.set(a, b, dark);
      grid.set(b, a, dark);
    }
  }
}

function drawFormatBits(grid: Grid, mask: number): void {
  const data = (ECC_FORMAT_M << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const { size } = grid;
  for (let i = 0; i <= 5; i++) grid.set(8, i, bit(i));
  grid.set(8, 7, bit(6));
  grid.set(8, 8, bit(7));
  grid.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) grid.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) grid.set(8, size - 15 + i, bit(i));
  grid.set(8, size - 8, true);
}

function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const { size } = grid;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!grid.fixed[y]![x] && i < codewords.length * 8) {
          grid.dark[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid: Grid, mask: number): void {
  for (let y = 0; y < grid.size; y++) for (let x = 0; x < grid.size; x++) if (!grid.fixed[y]![x] && MASKS[mask]!(x, y)) grid.dark[y]![x] = !grid.dark[y]![x];
}

/** The standard's penalty for a drawn symbol: runs, 2x2 blocks, finder-like patterns and the dark balance. */
function penalty(grid: Grid): number {
  const { size, dark } = grid;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    const cells = Array.from({ length: size }, (_, i) => (get(i) ? 1 : 0));
    const padded = [0, 0, 0, 0, ...cells, 0, 0, 0, 0];
    for (let i = 0; i + 11 <= padded.length; i++) {
      const window = padded.slice(i, i + 11).join('');
      if (window === '10111010000' || window === '00001011101') score += 40;
    }
  };
  for (let y = 0; y < size; y++) line(x => dark[y]![x]!);
  for (let x = 0; x < size; x++) line(y => dark[y]![x]!);
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) {
    const c = dark[y]![x];
    if (c === dark[y]![x + 1] && c === dark[y + 1]![x] && c === dark[y + 1]![x + 1]) score += 3;
  }
  const total = dark.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const k = Math.ceil(Math.abs(total * 20 - size * size * 10) / (size * size)) - 1;
  return score + Math.max(0, k) * 10;
}

/** The QR code for a text (UTF-8, byte mode, level M), smallest version that holds it. Throws past version 10. */
export function qrMatrix(text: string, options: { mask?: number } = {}): QrMatrix {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  while (version <= MAX_VERSION && dataCodewords(version) * 8 < 4 + (version <= 9 ? 8 : 16) + bytes.length * 8) version++;
  if (version > MAX_VERSION) throw new RangeError('This text is too long for a payment QR code.');
  const codewords = withErrorCorrection(encodeData(bytes, version), version);
  let best: { score: number; dark: boolean[][] } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    if (options.mask !== undefined && mask !== options.mask) continue;
    const grid = new Grid(version);
    drawFunctionPatterns(grid);
    drawCodewords(grid, codewords);
    applyMask(grid, mask);
    drawFormatBits(grid, mask);
    const score = penalty(grid);
    if (!best || score < best.score) best = { score, dark: grid.dark.map(row => [...row]) };
  }
  return { version, size: version * 4 + 17, rows: best!.dark.map(row => row.map(cell => (cell ? '1' : '0')).join('')) };
}
