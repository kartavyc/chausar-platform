// A small PNG reader and writer on node:zlib only, for comparing pictures pixel by pixel.
// Reads 8-bit greyscale, grey + alpha, RGB, RGBA and palette images (no interlace, which neither
// the design's pictures nor Chromium's screenshots use) into RGBA; writes RGBA, filter 0.
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** @returns {{ width: number, height: number, data: Uint8Array }} RGBA, row by row. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file.');
  let offset = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null, alpha = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const kind = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') alpha = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
  }
  if (depth !== 8 || interlace !== 0 || !(type in CHANNELS)) throw new Error(`Unsupported PNG: depth ${depth}, colour type ${type}, interlace ${interlace}.`);
  const channels = CHANNELS[type];
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[out + x - channels] : 0;
      const b = y > 0 ? pixels[out - stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[out - stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      pixels[out + x] = value & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    let r, g, b, a = 255;
    if (type === 0) { r = g = b = pixels[j]; }
    else if (type === 4) { r = g = b = pixels[j]; a = pixels[j + 1]; }
    else if (type === 2) { r = pixels[j]; g = pixels[j + 1]; b = pixels[j + 2]; }
    else if (type === 6) { r = pixels[j]; g = pixels[j + 1]; b = pixels[j + 2]; a = pixels[j + 3]; }
    else { const k = pixels[j]; r = palette[k * 3]; g = palette[k * 3 + 1]; b = palette[k * 3 + 2]; a = alpha && k < alpha.length ? alpha[k] : 255; }
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

const CRC_TABLE = (() => { const table = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; } return table; })();
function crc32(bytes) { let c = -1; for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(kind, body) {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** RGBA in, PNG bytes out. */
export function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Compare two pictures of the same size.
 * - `ratio`: the share of pixels whose largest channel difference is over `tolerance` (0-255),
 *   which absorbs anti-aliasing and font hinting but not a moved line or a different word.
 * - `blockRatio`: the share of `block` x `block` squares whose mean luminance differs by more
 *   than `blockTolerance` (0-1): a coarse layout difference, little moved by different text.
 * - `diff`: the reference washed out, with every differing pixel in red.
 */
export function comparePng(reference, actual, { tolerance = 32, block = 16, blockTolerance = 0.06 } = {}) {
  if (reference.width !== actual.width || reference.height !== actual.height) throw new Error(`Sizes differ: ${reference.width}x${reference.height} and ${actual.width}x${actual.height}.`);
  const { width, height } = reference;
  const diff = new Uint8Array(width * height * 4);
  let differing = 0;
  const luma = (data, i) => (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  for (let i = 0; i < width * height * 4; i += 4) {
    const delta = Math.max(Math.abs(reference.data[i] - actual.data[i]), Math.abs(reference.data[i + 1] - actual.data[i + 1]), Math.abs(reference.data[i + 2] - actual.data[i + 2]));
    if (delta > tolerance) { differing++; diff[i] = 230; diff[i + 1] = 30; diff[i + 2] = 40; }
    else { const grey = Math.round(255 - (1 - luma(reference.data, i)) * 0.25 * 255); diff[i] = diff[i + 1] = diff[i + 2] = grey; }
    diff[i + 3] = 255;
  }
  let blocks = 0, blocksDiffering = 0;
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      let sumA = 0, sumB = 0, n = 0;
      for (let y = by; y < Math.min(by + block, height); y++) for (let x = bx; x < Math.min(bx + block, width); x++) { const i = (y * width + x) * 4; sumA += luma(reference.data, i); sumB += luma(actual.data, i); n++; }
      blocks++;
      if (Math.abs(sumA - sumB) / n > blockTolerance) blocksDiffering++;
    }
  }
  return { width, height, differing, ratio: differing / (width * height), blockRatio: blocksDiffering / blocks, diff: { width, height, data: diff } };
}
