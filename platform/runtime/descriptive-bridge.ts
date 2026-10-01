import { check } from './contracts.ts';

export const DESCRIPTIVE_BRIDGE_REVISION = 'chausar-descriptive-bridge/1' as const;

/** A service-authored product population; quantity is an exact scaled integer. */
export type BridgeFactorRow = { key: string; amountMinor: string; quantity: string | null; unit: string | null };
export type DescriptiveBridgeInput = {
  baseline: BridgeFactorRow[]; comparison: BridgeFactorRow[]; quantityScale: number;
  method: 'separate-interaction'; factorRule: 'realized-average-net-amount-per-unit';
  rounding: 'truncate-toward-zero-minor'; incompleteCoverage: 'partial' | 'refuse'; coverageGaps?: string[];
};
export type ExactBridgeFraction = { numerator: string; denominator: string };
export type BridgeContributions = {
  volumeMinor: string; priceMinor: string; interactionMinor: string; scopeAddedMinor: string; scopeRemovedMinor: string;
};
export type BridgeResidual = { missingFactorMinor: string; roundingMinor: string; totalMinor: string };
export type BridgeProductResult = {
  key: string; population: 'common' | 'added' | 'removed'; status: 'decomposed' | 'scope' | 'missing-factors';
  baselineAmountMinor: string | null; comparisonAmountMinor: string | null; measuredDeltaMinor: string;
  contributions: BridgeContributions | null; residual: BridgeResidual;
  exact: {
    baselinePriceMinorPerUnit: ExactBridgeFraction; comparisonPriceMinorPerUnit: ExactBridgeFraction;
    volumeMinor: ExactBridgeFraction; priceMinor: ExactBridgeFraction; interactionMinor: ExactBridgeFraction;
  } | null;
};
export type DescriptiveBridgeResult = {
  implementationRevision: typeof DESCRIPTIVE_BRIDGE_REVISION;
  method: DescriptiveBridgeInput['method']; factorRule: DescriptiveBridgeInput['factorRule'];
  rounding: DescriptiveBridgeInput['rounding']; quantityScale: number;
  status: 'complete' | 'partial' | 'refused'; baselineTotalMinor: string; comparisonTotalMinor: string;
  measuredDeltaMinor: string; contributions: BridgeContributions | null; residual: BridgeResidual | null;
  products: BridgeProductResult[]; gaps: string[];
};

const maxRows = 10_000, maxIntegerDigits = 256, maxKeyLength = 512, maxUnitLength = 128;
const inputKeys = ['baseline', 'comparison', 'quantityScale', 'method', 'factorRule', 'rounding', 'incompleteCoverage', 'coverageGaps'];
const rowKeys = ['key', 'amountMinor', 'quantity', 'unit'];
const plainRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;
const boundedText = (value: unknown, limit: number): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= limit && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const integerText = (value: unknown): value is string => typeof value === 'string'
  && value.length <= maxIntegerDigits + (value.startsWith('-') ? 1 : 0) && /^(?:0|-?[1-9]\d*)$/.test(value);

function validateRows(rows: unknown, population: string): asserts rows is BridgeFactorRow[] {
  check(Array.isArray(rows) && rows.length <= maxRows, 'BRIDGE_INPUT_INVALID', 'Use a bounded declared product population.');
  const seen = new Set<string>();
  for (const row of rows) {
    check(plainRecord(row) && Object.keys(row).length === rowKeys.length && rowKeys.every(key => Object.hasOwn(row, key))
      && boundedText(row.key, maxKeyLength) && integerText(row.amountMinor)
      && (row.quantity === null || (integerText(row.quantity) && BigInt(row.quantity) >= 0n))
      && (row.unit === null || boundedText(row.unit, maxUnitLength)),
    'BRIDGE_INPUT_INVALID', 'Product rows require explicit identity, exact money, nonnegative scaled quantity and unit bindings.');
    check(!seen.has(row.key), 'BRIDGE_INPUT_INVALID', `A ${population} product key occurs more than once.`);
    seen.add(row.key);
  }
}

type Fraction = { numerator: bigint; denominator: bigint };
function fraction(numerator: bigint, denominator: bigint): Fraction {
  // Denominators originate only from positive known quantities.
  let a = numerator < 0n ? -numerator : numerator, b = denominator;
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder; }
  const divisor = a || 1n;
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
const expose = (value: Fraction): ExactBridgeFraction => ({ numerator: String(value.numerator), denominator: String(value.denominator) });
const zeroContributions = (): BridgeContributions => ({ volumeMinor: '0', priceMinor: '0', interactionMinor: '0', scopeAddedMinor: '0', scopeRemovedMinor: '0' });
const residual = (missing: bigint, rounding: bigint): BridgeResidual => ({ missingFactorMinor: String(missing), roundingMinor: String(rounding), totalMinor: String(missing + rounding) });

/**
 * Descriptive amount/quantity arithmetic only. This kernel does not infer product,
 * quantity, unit, coverage, currency or causality from source fields.
 * Each common product's three exact contributions is truncated toward zero before
 * summation; the rounding residual retains their difference from the exact change.
 */
export function computeDescriptiveBridge(input: DescriptiveBridgeInput): DescriptiveBridgeResult {
  check(plainRecord(input) && Object.keys(input).every(key => inputKeys.includes(key))
    && input.method === 'separate-interaction' && input.factorRule === 'realized-average-net-amount-per-unit'
    && input.rounding === 'truncate-toward-zero-minor' && (input.incompleteCoverage === 'partial' || input.incompleteCoverage === 'refuse')
    && Number.isInteger(input.quantityScale) && input.quantityScale >= 0 && input.quantityScale <= 6,
  'BRIDGE_INPUT_INVALID', 'Declare the supported bridge method, factor rule, rounding, quantity scale and coverage policy.');
  validateRows(input.baseline, 'baseline'); validateRows(input.comparison, 'comparison');
  check(input.coverageGaps === undefined || (Array.isArray(input.coverageGaps) && input.coverageGaps.length <= maxRows * 2
    && input.coverageGaps.every(gap => boundedText(gap, maxKeyLength))),
  'BRIDGE_INPUT_INVALID', 'Coverage gaps must be bounded explicit descriptions.');

  const baseline = new Map(input.baseline.map(row => [row.key, row]));
  const comparison = new Map(input.comparison.map(row => [row.key, row]));
  const gaps = new Set(input.coverageGaps ?? []);
  if (baseline.size === 0) gaps.add('baseline:empty-population');
  if (comparison.size === 0) gaps.add('comparison:empty-population');
  const keys = [...new Set([...baseline.keys(), ...comparison.keys()])].sort();
  const products: BridgeProductResult[] = [];
  let baselineTotal = 0n, comparisonTotal = 0n, volume = 0n, price = 0n, interaction = 0n, added = 0n, removed = 0n;
  let missingFactor = 0n, rounding = 0n;
  const quantityMultiplier = 10n ** BigInt(input.quantityScale);

  for (const key of keys) {
    const before = baseline.get(key), after = comparison.get(key);
    const a0 = before ? BigInt(before.amountMinor) : 0n, a1 = after ? BigInt(after.amountMinor) : 0n;
    baselineTotal += a0; comparisonTotal += a1;
    const delta = a1 - a0;
    const base = { key, baselineAmountMinor: before?.amountMinor ?? null, comparisonAmountMinor: after?.amountMinor ?? null, measuredDeltaMinor: String(delta) };
    if (!before || !after) {
      const contributions = zeroContributions();
      if (!before) { added += a1; contributions.scopeAddedMinor = String(a1); }
      else { removed -= a0; contributions.scopeRemovedMinor = String(-a0); }
      products.push({ ...base, population: before ? 'removed' : 'added', status: 'scope', contributions, residual: residual(0n, 0n), exact: null });
      continue;
    }

    const productGaps: string[] = [];
    for (const [population, row] of [['baseline', before], ['comparison', after]] as const) {
      if (row.quantity === null) productGaps.push(`${population}:${key}:missing-quantity`);
      else if (BigInt(row.quantity) === 0n) productGaps.push(`${population}:${key}:zero-quantity`);
      if (row.unit === null) productGaps.push(`${population}:${key}:missing-unit`);
    }
    if (before.unit !== null && after.unit !== null && before.unit !== after.unit) productGaps.push(`common:${key}:unit-mismatch`);
    if (productGaps.length > 0) {
      productGaps.forEach(gap => gaps.add(gap)); missingFactor += delta;
      products.push({ ...base, population: 'common', status: 'missing-factors', contributions: null, residual: residual(delta, 0n), exact: null });
      continue;
    }

    const q0 = BigInt(before.quantity!), q1 = BigInt(after.quantity!);
    const quantityChange = q1 - q0, priceChangeNumerator = a1 * q0 - a0 * q1;
    const exactVolume = fraction(a0 * quantityChange, q0);
    const exactPrice = fraction(priceChangeNumerator, q1);
    const exactInteraction = fraction(quantityChange * priceChangeNumerator, q0 * q1);
    const productVolume = exactVolume.numerator / exactVolume.denominator;
    const productPrice = exactPrice.numerator / exactPrice.denominator;
    const productInteraction = exactInteraction.numerator / exactInteraction.denominator;
    const productRounding = delta - productVolume - productPrice - productInteraction;
    volume += productVolume; price += productPrice; interaction += productInteraction; rounding += productRounding;
    products.push({ ...base, population: 'common', status: 'decomposed',
      contributions: { ...zeroContributions(), volumeMinor: String(productVolume), priceMinor: String(productPrice), interactionMinor: String(productInteraction) },
      residual: residual(0n, productRounding), exact: {
        baselinePriceMinorPerUnit: expose(fraction(a0 * quantityMultiplier, q0)),
        comparisonPriceMinorPerUnit: expose(fraction(a1 * quantityMultiplier, q1)),
        volumeMinor: expose(exactVolume), priceMinor: expose(exactPrice), interactionMinor: expose(exactInteraction),
      },
    });
  }

  const orderedGaps = [...gaps].sort();
  const refused = orderedGaps.length > 0 && input.incompleteCoverage === 'refuse';
  return {
    implementationRevision: DESCRIPTIVE_BRIDGE_REVISION, method: input.method, factorRule: input.factorRule,
    rounding: input.rounding, quantityScale: input.quantityScale,
    status: refused ? 'refused' : orderedGaps.length > 0 ? 'partial' : 'complete',
    baselineTotalMinor: String(baselineTotal), comparisonTotalMinor: String(comparisonTotal), measuredDeltaMinor: String(comparisonTotal - baselineTotal),
    contributions: refused ? null : { volumeMinor: String(volume), priceMinor: String(price), interactionMinor: String(interaction), scopeAddedMinor: String(added), scopeRemovedMinor: String(removed) },
    residual: refused ? null : residual(missingFactor, rounding), products: refused ? [] : products, gaps: orderedGaps,
  };
}
