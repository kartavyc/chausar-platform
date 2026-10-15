// The pixel comparison's own pieces: the zlib-only PNG reader and writer, the comparison, and the
// thresholds file (every picture the preview draws has an allowed ratio and the reason it is not zero).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { comparePng, decodePng, encodePng } from '../../../frontend-validation/visual/png.mjs';
import { PICTURES } from '../../../frontend-validation/visual/pictures.mjs';

function picture(width: number, height: number, paint: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b] = paint(x, y); data.set([r, g, b, 255], (y * width + x) * 4); }
  return { width, height, data };
}

test('a PNG written and read back is the same picture', () => {
  const original = picture(37, 21, (x, y) => [x * 6, y * 12, (x * y) % 256]);
  const back = decodePng(encodePng(original));
  assert.equal(back.width, 37);
  assert.equal(back.height, 21);
  assert.deepEqual(Buffer.from(back.data), Buffer.from(original.data));
});

test('an RGB PNG with every row filter reads correctly', () => {
  // Hand-built 3x5 RGB, one row per filter: None, Up, Sub, Average, Paeth.
  const width = 3, height = 5;
  const rows = [
    [0, 10, 20, 30, 10, 20, 30, 10, 20, 30],
    [2, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 5, 5, 5, 1, 1, 1, 1, 1, 1],
    [3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [4, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ].flat();
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const chunk = (kind: string, body: Buffer) => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1'); return Buffer.concat([head, body, Buffer.alloc(4)]); };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
  const read = decodePng(png);
  const px = (x: number, y: number) => [...read.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  assert.deepEqual(px(2, 0), [10, 20, 30, 255]); // None
  assert.deepEqual(px(0, 1), [11, 21, 31, 255]); // Up: the row above plus one
  assert.deepEqual([px(0, 2), px(1, 2), px(2, 2)], [[5, 5, 5, 255], [6, 6, 6, 255], [7, 7, 7, 255]]); // Sub: the left pixel plus one
  assert.deepEqual([px(0, 3), px(1, 3)], [[2, 2, 2, 255], [4, 4, 4, 255]]); // Average of left and up, rounded down
  assert.deepEqual(px(0, 4), [2, 2, 2, 255]); // Paeth picks the pixel above
});

test('the comparison counts differing pixels over the tolerance and marks them red', () => {
  const a = picture(20, 10, () => [200, 200, 200]);
  const b = picture(20, 10, (x) => (x < 5 ? [0, 0, 0] : x < 10 ? [220, 210, 190] : [200, 200, 200]));
  const result = comparePng(a, b, { tolerance: 32, block: 10, blockTolerance: 0.06 });
  assert.equal(result.differing, 50); // the five black columns; the slightly different ones are within tolerance
  assert.equal(result.ratio, 0.25);
  assert.equal(result.blockRatio, 0.5);
  assert.deepEqual([...result.diff.data.subarray(0, 4)], [230, 30, 40, 255]);
  assert.equal(comparePng(a, a).ratio, 0);
  assert.throws(() => comparePng(a, picture(10, 10, () => [0, 0, 0])), /Sizes differ/);
});

test('every picture the preview draws has an allowed ratio and a reason', () => {
  const thresholds = JSON.parse(readFileSync(new URL('../../../frontend-validation/visual/thresholds.json', import.meta.url), 'utf8')).pictures as Record<string, { maxRatio: number; reason: string }>;
  for (const entry of PICTURES.filter(item => item.address !== null)) {
    const threshold = thresholds[entry.name];
    assert.ok(threshold, `${entry.name} has a threshold`);
    assert.ok(threshold.maxRatio > 0 && threshold.maxRatio < 1, `${entry.name}: a ratio between 0 and 1`);
    assert.ok(threshold.reason.length > 40, `${entry.name}: a reason for the difference`);
  }
});
