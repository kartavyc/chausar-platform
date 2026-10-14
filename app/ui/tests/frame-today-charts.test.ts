import assert from 'node:assert/strict';
import test from 'node:test';
import { exactLinear, includeZero, nextMarkIndex, pathOf, pixelSpan, runsOf, slotEdges, stepRuns } from '../src/parts/charts/scale.ts';

test('runsOf breaks a line at every missing point and keeps lone points as runs', () => {
  const p = (x: number, y: number) => ({ x, y });
  assert.deepEqual(runsOf([]), []);
  assert.deepEqual(runsOf([null, null]), []);
  assert.deepEqual(runsOf([p(0, 1), p(1, 2), null, p(3, 4), null, null, p(6, 7), p(7, 8)]), [[p(0, 1), p(1, 2)], [p(3, 4)], [p(6, 7), p(7, 8)]]);
});

test('pathOf writes a move then lines, to a tenth of a pixel', () => {
  assert.equal(pathOf([{ x: 0, y: 1.234 }, { x: 10.05, y: 2 }]), 'M0.0 1.2 L10.1 2.0');
  assert.equal(pathOf([]), '');
});

test('pixelSpan orders the ends of a bar from zero for positive, negative and zero values', () => {
  const x = exactLinear(-100n, 100n, 0, 200);
  assert.deepEqual(pixelSpan(x, 0n, 50n), { lo: 100, hi: 150, size: 50, rising: true });
  assert.deepEqual(pixelSpan(x, 0n, -50n), { lo: 50, hi: 100, size: 50, rising: false });
  assert.deepEqual(pixelSpan(x, 0n, 0n), { lo: 100, hi: 100, size: 0, rising: true });
  // An inverted vertical scale: a rising value goes up the screen.
  const y = exactLinear(0n, 100n, 48, 0);
  const up = pixelSpan(y, 20n, 80n);
  assert.equal(up.rising, false);
  assert.ok(Math.abs(up.lo - 9.6) < 1e-6 && Math.abs(up.hi - 38.4) < 1e-6);
});

test('pixelSpan keeps adjacent huge exact levels apart and finite', () => {
  const big = 10n ** 40n;
  // Bridge levels from the engine: each cause's ends are scaled, never computed.
  const x = exactLinear(big, big + 2n, 0, 1000);
  assert.deepEqual(pixelSpan(x, big, big + 1n), { lo: 0, hi: 500, size: 500, rising: true });
  assert.deepEqual(pixelSpan(x, big + 2n, big + 1n), { lo: 500, hi: 1000, size: 500, rising: false });
  // With zero in the domain the same levels stay finite and inside the range.
  const domain = includeZero({ min: -big, max: big });
  const y = exactLinear(domain.min, domain.max, 0, 1000);
  const span = pixelSpan(y, -big, big);
  assert.deepEqual(span, { lo: 0, hi: 1000, size: 1000, rising: true });
});

test('slotEdges gives n + 1 equal edges and refuses a bad count', () => {
  assert.deepEqual(slotEdges(4, 0, 100), [0, 25, 50, 75, 100]);
  assert.deepEqual(slotEdges(0, 0, 100), [0]);
  assert.throws(() => slotEdges(-1, 0, 100), /SCALE_BAD_SLOTS/);
  assert.throws(() => slotEdges(1.5, 0, 100), /SCALE_BAD_SLOTS/);
});

test('stepRuns holds each step until the next edge and breaks at a gap', () => {
  const edges = [0, 10, 20, 30, 40];
  assert.deepEqual(stepRuns([5, 8, null, 2], edges), [
    { first: 0, points: [{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 8 }, { x: 20, y: 8 }] },
    { first: 3, points: [{ x: 30, y: 2 }, { x: 40, y: 2 }] },
  ]);
  assert.deepEqual(stepRuns([null, null], [0, 1, 2]), []);
  assert.deepEqual(stepRuns([], [0]), []);
});

test('nextMarkIndex moves mark to mark, holds at the ends, and ignores other keys', () => {
  assert.equal(nextMarkIndex(0, 3, 'ArrowRight'), 1);
  assert.equal(nextMarkIndex(1, 3, 'ArrowDown'), 2);
  assert.equal(nextMarkIndex(2, 3, 'ArrowRight'), 2);
  assert.equal(nextMarkIndex(0, 3, 'ArrowLeft'), 0);
  assert.equal(nextMarkIndex(2, 3, 'ArrowUp'), 1);
  assert.equal(nextMarkIndex(1, 3, 'Home'), 0);
  assert.equal(nextMarkIndex(0, 3, 'End'), 2);
  assert.equal(nextMarkIndex(0, 3, 'Enter'), null);
  assert.equal(nextMarkIndex(0, 0, 'ArrowRight'), null);
});
