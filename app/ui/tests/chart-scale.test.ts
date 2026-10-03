import assert from 'node:assert/strict';
import test from 'node:test';
import { BAR_MAX, BAR_RADIUS, exactExtent, exactLinear, exactShares, extent, HIT_RADIUS, includeZero, linear, toExact, toNumber } from '../src/parts/charts/scale.ts';

test('geometry parses known zero and signed exact integers, and keeps malformed/unknown data absent', () => {
  assert.equal(toExact('0'), 0n);
  assert.equal(toExact('-12500'), -12500n);
  assert.equal(toExact('12500'), 12500n);
  assert.equal(toNumber('0'), 0);
  assert.equal(toNumber('-12500'), -12500);
  assert.equal(toNumber('12500'), 12500);
  for (const value of ['', 'unknown', 'null', '12.50', '1e6', 'NaN', 'Infinity', ' 100 ', '100px']) {
    assert.equal(toExact(value), null, value);
    assert.equal(toNumber(value), null, value);
  }
});

test('integer conversion never supplies nonfinite SVG geometry', () => {
  for (const value of ['9'.repeat(400), `-${'9'.repeat(400)}`]) assert.equal(toNumber(value), null);
});

test('plain-number conversion refuses precision loss instead of silently rounding an exact value', () => {
  assert.equal(toNumber('9007199254740991'), Number.MAX_SAFE_INTEGER);
  assert.equal(toNumber('-9007199254740991'), -Number.MAX_SAFE_INTEGER);
  for (const value of ['9007199254740992', '9007199254740993', '-9007199254740992', '-9007199254740993']) {
    assert.equal(toNumber(value), null, value);
    assert.equal(toExact(value), BigInt(value), value);
  }
});

test('missing points are excluded from the domain while known zero and negatives remain measured', () => {
  assert.deepEqual(extent([null, 0, null]), { min: 0, max: 0 });
  assert.deepEqual(extent([null, -12500, 0, 25000, null]), { min: -12500, max: 25000 });
  assert.equal(extent([]), null);
  assert.equal(extent([null, null]), null);
  for (const values of [[NaN], [Infinity], [-Infinity], [10, Infinity]]) assert.equal(extent(values), null);
});

test('linear geometry places negative, zero and positive values on one finite scale', () => {
  const y = linear(-100, 100, 48, 0);
  assert.equal(y(-100), 48);
  assert.equal(y(0), 24);
  assert.equal(y(100), 0);
  assert.equal(linear(100, -100, 0, 48)(0), 24);
});

test('a known zero on a collapsed baseline stays at the baseline instead of drawing a full-height bar', () => {
  assert.equal(linear(0, 0, 48, 0)(0), 48);
});

test('invalid domains and ranges are rejected before they can become NaN SVG attributes', () => {
  for (const ends of [[NaN, 10, 48, 0], [0, Infinity, 48, 0], [-Infinity, 10, 48, 0], [0, 10, NaN, 0], [0, 10, 48, Infinity]] as const) {
    assert.throws(() => linear(ends[0], ends[1], ends[2], ends[3]));
  }
});

test('a valid scale rejects nonfinite points rather than putting NaN or Infinity in an SVG attribute', () => {
  const y = linear(-100, 100, 48, 0);
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => y(value));
});

test('large finite signed domains still yield finite endpoint and midpoint geometry', () => {
  const y = linear(-Number.MAX_VALUE, Number.MAX_VALUE, 48, 0);
  assert.equal(y(-Number.MAX_VALUE), 48);
  assert.equal(y(0), 24);
  assert.equal(y(Number.MAX_VALUE), 0);
});

test('plain geometry clamps out-of-domain points and keeps extreme finite pixel ranges finite', () => {
  const max = Number.MAX_VALUE;
  const extreme = linear(-max, max, -max, max);
  assert.equal(extreme(-max), -max);
  assert.equal(extreme(0), 0);
  assert.equal(extreme(max), max);
  assert.equal(linear(max, -max, max, -max)(0), 0);
  const bounded = linear(0, 1, 0, 200);
  assert.equal(bounded(-max), 0);
  assert.equal(bounded(max), 200);
  assert.equal(linear(1, 0, 0, 200)(max), 0);
  assert.equal(linear(1, 0, 0, 200)(-max), 200);
  const positive = linear(0, 1, max / 2, max);
  for (const value of [0, 0.1, 0.5, 0.9, 1]) {
    const pixel = positive(value);
    assert.ok(Number.isFinite(pixel) && pixel >= max / 2 && pixel <= max);
  }
});

test('distinct tiny finite domain endpoints do not collapse when half-span would underflow', () => {
  const tiny = Number.MIN_VALUE;
  assert.equal(linear(0, tiny, 0, 100)(tiny), 100);
  assert.equal(linear(-tiny, tiny, 0, 100)(0), 50);
});

test('distinct exact endpoints beyond the safe integer limit remain distinct in chart geometry', () => {
  // These engine values differ by one exact unit. Converting their absolute values
  // to Number before domain normalization erases that real variation while staying
  // finite. Normalize the exact integer domain first, then project visual positions.
  for (const [first, last] of [
    ['9007199254740992', '9007199254740993'],
    ['-9007199254740993', '-9007199254740992'],
    [`1${'0'.repeat(100)}`, `1${'0'.repeat(99)}1`],
  ] as const) {
    assert.equal(BigInt(last) - BigInt(first), 1n);
    const a = toExact(first), b = toExact(last);
    assert.notEqual(a, null); assert.notEqual(b, null);
    const domain = exactExtent([a, b]);
    assert.ok(domain);
    assert.deepEqual(domain, { min: BigInt(first), max: BigInt(last) });
    const x = exactLinear(domain.min, domain.max, 0, 100);
    assert.equal(x(a!), 0, `first endpoint ${first}`);
    assert.equal(x(b!), 100, `last endpoint ${last} must not collapse onto the first`);
  }
});

test('exact domains keep missing points distinct from measured zero and signed values', () => {
  assert.equal(exactExtent([]), null);
  assert.equal(exactExtent([null, null]), null);
  assert.deepEqual(exactExtent([null, 0n, null]), { min: 0n, max: 0n });
  assert.deepEqual(exactExtent([null, -12500n, 0n, 25000n, null]), { min: -12500n, max: 25000n });
});

test('bar domains include one truthful zero baseline without mutating the measured domain', () => {
  const positive = Object.freeze({ min: 10n, max: 100n });
  const negative = Object.freeze({ min: -100n, max: -10n });
  assert.deepEqual(includeZero(positive), { min: 0n, max: 100n });
  assert.deepEqual(includeZero(negative), { min: -100n, max: 0n });
  assert.deepEqual(includeZero({ min: -100n, max: 100n }), { min: -100n, max: 100n });
  assert.deepEqual(positive, { min: 10n, max: 100n });
  assert.deepEqual(negative, { min: -100n, max: -10n });
  const y = exactLinear(-100n, 100n, 48, 0);
  assert.equal(y(-100n), 48); assert.equal(y(0n), 24); assert.equal(y(100n), 0);
  assert.equal(exactLinear(0n, 0n, 48, 0)(0n), 48);
});

test('exact geometry stays bounded for huge integers, reversed axes and points outside the domain', () => {
  const huge = BigInt(`1${'0'.repeat(400)}`);
  const y = exactLinear(-huge, huge, 48, 0);
  assert.equal(y(-huge), 48); assert.equal(y(0n), 24); assert.equal(y(huge), 0);
  assert.equal(y(-huge * 2n), 48); assert.equal(y(huge * 2n), 0);
  const reversed = exactLinear(huge, -huge, 0, 100);
  assert.equal(reversed(huge), 0); assert.equal(reversed(0n), 50); assert.equal(reversed(-huge), 100);
  for (const range of [[NaN, 0], [0, Infinity], [-Infinity, 0]] as const) {
    assert.throws(() => exactLinear(0n, huge, range[0], range[1]));
  }
});

test('segment shares never invent positive area for all-zero, missing-only or negative parts', () => {
  for (const parts of [[], [null], [0n], [0n, 0n, null], [-1n], [10n, -1n, null]]) assert.equal(exactShares(parts), null);
  assert.deepEqual(exactShares([10n, null, 0n, 30n]), [0.25, null, 0, 0.75]);
});

test('segment shares use exact large values and preserve missing positions without nonfinite geometry', () => {
  const huge = BigInt(`1${'0'.repeat(400)}`);
  const parts = Object.freeze([huge, null, huge, 0n]);
  const shares = exactShares(parts);
  assert.deepEqual(shares, [0.5, null, 0.5, 0]);
  assert.deepEqual(parts, [huge, null, huge, 0n]);
  assert.ok(shares);
  for (const share of shares) if (share !== null) assert.ok(Number.isFinite(share) && share >= 0 && share <= 1);
});

test('chart marks retain the authored visible and keyboard target dimensions', () => {
  assert.equal(BAR_MAX, 24);
  assert.equal(BAR_RADIUS, 4);
  assert.ok(HIT_RADIUS * 2 >= 24);
});
