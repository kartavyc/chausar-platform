/**
 * Chart geometry only. A chart takes exact values as strings and works out where to draw
 * them. Nothing here is a business number: the span of a domain and the whole of a bar
 * are used for pixel positions and are never shown or returned to a screen.
 *
 * Exact values stay exact (BigInt) until they have been normalised against their own
 * domain. Only the bounded result, a whole number of steps between 0 and STEPS, becomes a
 * floating-point number. Two values one unit apart therefore keep their relative
 * positions however large they are, and no SVG attribute can become NaN or Infinity.
 *
 * build.md recommends d3-scale for this; the three forms in this slice need only a
 * linear scale, so a dependency is not taken yet.
 */

/** Parse an exact integer string. Malformed gives null. Nothing is rounded here. */
export function toExact(digits: string): bigint | null {
  return /^-?\d+$/.test(digits) ? BigInt(digits) : null;
}

const SAFE_LIMIT = 9007199254740991n;

/** An exact integer string as a plain number, only where a number holds it exactly.
 *  Anything malformed or beyond the safe integer range gives null. Chart positions do not
 *  use this; they use `exactLinear`, which keeps values beyond that range apart. */
export function toNumber(digits: string): number | null {
  const parsed = toExact(digits);
  if (parsed === null || parsed > SAFE_LIMIT || parsed < -SAFE_LIMIT) return null;
  return Number(digits);
}

export interface ExactDomain {
  readonly min: bigint;
  readonly max: bigint;
}

/** The smallest and largest known values. Missing points are skipped. */
export function exactExtent(values: ReadonlyArray<bigint | null>): ExactDomain | null {
  let min: bigint | null = null;
  let max: bigint | null = null;
  for (const v of values) {
    if (v === null) continue;
    if (min === null || v < min) min = v;
    if (max === null || v > max) max = v;
  }
  return min === null || max === null ? null : { min, max };
}

/** A domain widened to hold zero, so bars above and below share one zero baseline. */
export function includeZero(domain: ExactDomain): ExactDomain {
  return { min: domain.min < 0n ? domain.min : 0n, max: domain.max > 0n ? domain.max : 0n };
}

/** The resolution of a normalised position: far finer than a pixel, far inside the range
 *  a floating-point number holds exactly. */
const STEPS = 1073741824;
const STEPS_EXACT = 1073741824n;

/** Where `offset` falls inside `span`, from 0 to 1. `span` is above zero. The division is
 *  exact; only its bounded result is converted. */
function unit(offset: bigint, span: bigint): number {
  const clamped = offset < 0n ? 0n : offset > span ? span : offset;
  const scaled = (clamped * STEPS_EXACT) / span;
  return Number(scaled) / STEPS;
}

/** A linear scale from an exact domain to a pixel range. A collapsed domain maps
 *  everything to the range's start (the baseline), so a known zero stays at the baseline
 *  and never draws a full-height bar. A point outside the domain is held at its end. */
export function exactLinear(d0: bigint, d1: bigint, r0: number, r1: number): (v: bigint) => number {
  for (const end of [r0, r1]) {
    if (!Number.isFinite(end)) throw new RangeError('SCALE_NONFINITE_END');
  }
  const reversed = d1 < d0;
  const span = reversed ? d0 - d1 : d1 - d0;
  return (v) => {
    if (span === 0n) return r0;
    const t = unit(reversed ? d0 - v : v - d0, span);
    return r0 * (1 - t) + r1 * t;
  };
}

/** Each known part as a bounded share of all the known parts, for segment widths only.
 *  The whole is never returned. Null when a part is below zero or when nothing has any
 *  size: a share is never invented. A missing part stays null. */
export function exactShares(parts: ReadonlyArray<bigint | null>): ReadonlyArray<number | null> | null {
  let whole = 0n;
  for (const part of parts) {
    if (part === null) continue;
    if (part < 0n) return null;
    whole += part;
  }
  if (whole === 0n) return null;
  const span = whole;
  return parts.map((part) => (part === null ? null : unit(part, span)));
}

/** The smallest and largest of plain coordinates. Missing points are skipped; any
 *  non-finite value makes the whole extent unusable. */
export function extent(values: ReadonlyArray<number | null>): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const v of values) {
    if (v === null) continue;
    if (!Number.isFinite(v)) return null;
    seen = true;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return seen ? { min, max } : null;
}

/** A bounded linear scale between plain coordinates (an index along the page, for one).
 *  A collapsed domain maps everything to the range's start. Wide domains are normalised
 *  in halves, and convex interpolation keeps even opposite finite range ends finite. */
export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  for (const end of [d0, d1, r0, r1]) {
    if (!Number.isFinite(end)) throw new RangeError('SCALE_NONFINITE_END');
  }
  const span = d1 - d0;
  const lower = Math.min(r0, r1);
  const upper = Math.max(r0, r1);
  return (v) => {
    if (!Number.isFinite(v)) throw new RangeError('SCALE_NONFINITE_VALUE');
    if (d0 === d1) return r0;
    if (d0 < d1 ? v <= d0 : v >= d0) return r0;
    if (d0 < d1 ? v >= d1 : v <= d1) return r1;
    const fraction = Number.isFinite(span)
      ? (v - d0) / span
      : (v / 2 - d0 / 2) / (d1 / 2 - d0 / 2);
    const t = Math.max(0, Math.min(1, fraction));
    const coordinate = r0 * (1 - t) + r1 * t;
    return Math.max(lower, Math.min(upper, coordinate));
  };
}

/** Bars at most 24 wide, the far end rounded by 4 (main design, part 6). These mirror
 *  --bar-w and --bar-r; SVG attributes cannot read a custom property for geometry. */
export const BAR_MAX = 24;
export const BAR_RADIUS = 4;
/** Half of the invisible 24 pixel target around a mark, however small the mark is. */
export const HIT_RADIUS = 12;
