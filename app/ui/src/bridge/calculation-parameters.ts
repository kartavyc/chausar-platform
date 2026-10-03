import { ReplyValidationError, assertISODate } from './validate.ts';

// Current gateway v1 calculation review DTOs. These presentation checks do not
// grant Engine authority; the exact wire payload and its server approval remain.
export interface CalculationPeriod { readonly from: string; readonly to: string }
export interface ReviewedCalculationParameters {
  readonly period?: CalculationPeriod; readonly comparePeriod?: CalculationPeriod;
  readonly assumptions?: { readonly priceChangeBps: string };
}
export type CalculationParameterKey = 'period' | 'comparePeriod' | 'assumptions';
export type CalculationParameterOrigins = Readonly<Partial<Record<CalculationParameterKey, 'owner-requested' | 'retained-owner-requested'>>>;
export interface CalculationParameterDisclosure {
  readonly kind: 'owner-requested-calculation-parameters';
  readonly period: CalculationPeriod | null; readonly comparePeriod: CalculationPeriod | null;
  readonly assumptions: { readonly origin: 'owner-requested'; readonly label: string; readonly priceChangeBps: string } | null;
  readonly missingInputClarifications: { readonly change: string | null; readonly scenario: string | null };
  readonly origins: CalculationParameterOrigins;
}
export const calculationParameterKeys = ['period', 'comparePeriod', 'assumptions'] as const;
export const ownerRequestedScenarioLabel = 'Owner-requested price assumption in basis points; scenario only, not a measured fact.';
const fail = (path: string): never => { throw new ReplyValidationError(path); };
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail(path);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(path);
  return value as Record<string, unknown>;
}
function shape(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const checked = object(value, path);
  if (required.some(key => !Object.hasOwn(checked, key)) || Object.keys(checked).some(key => !required.includes(key) && !optional.includes(key)) || Object.values(checked).some(item => item === undefined)) fail(path);
  return checked;
}
function period(value: unknown, path: string): CalculationPeriod {
  const checked = shape(value, path, ['from', 'to']);
  assertISODate(checked.from, path + '.from'); assertISODate(checked.to, path + '.to');
  if (checked.from > checked.to) fail(path);
  return { from: checked.from, to: checked.to };
}
function price(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 20000 || !/^-?[0-9]+$/.test(value)) return fail(path);
  const integer = BigInt(value);
  if (integer < -10000n || integer > 100000n) fail(path);
  return value;
}
export function validateReviewedCalculationParameters(value: unknown, path: string): ReviewedCalculationParameters {
  const checked = shape(value, path, [], calculationParameterKeys);
  const selected: { period?: CalculationPeriod; comparePeriod?: CalculationPeriod; assumptions?: { priceChangeBps: string } } = {};
  if (Object.hasOwn(checked, 'period')) selected.period = period(checked.period, path + '.period');
  if (Object.hasOwn(checked, 'comparePeriod')) selected.comparePeriod = period(checked.comparePeriod, path + '.comparePeriod');
  if (Object.hasOwn(checked, 'assumptions')) {
    const assumption = shape(checked.assumptions, path + '.assumptions', ['priceChangeBps']);
    selected.assumptions = { priceChangeBps: price(assumption.priceChangeBps, path + '.assumptions.priceChangeBps') };
  }
  return selected;
}
export function validateCalculationParameterOrigins(value: unknown, parameters: ReviewedCalculationParameters, path: string): CalculationParameterOrigins {
  const checked = shape(value, path, [], calculationParameterKeys);
  for (const key of calculationParameterKeys) {
    if (Object.hasOwn(checked, key) !== Object.hasOwn(parameters, key)) fail(path + '.' + key);
    if (Object.hasOwn(checked, key) && checked[key] !== 'owner-requested' && checked[key] !== 'retained-owner-requested') fail(path + '.' + key);
  }
  return checked as CalculationParameterOrigins;
}
export function calculationParameterDisclosure(parameters: ReviewedCalculationParameters, origins: CalculationParameterOrigins): CalculationParameterDisclosure {
  return { kind: 'owner-requested-calculation-parameters', period: parameters.period ?? null, comparePeriod: parameters.comparePeriod ?? null,
    assumptions: parameters.assumptions ? { origin: 'owner-requested', label: ownerRequestedScenarioLabel, priceChangeBps: parameters.assumptions.priceChangeBps } : null,
    missingInputClarifications: {
      change: !parameters.period && !parameters.comparePeriod ? 'Which current and comparison periods should I use?'
        : !parameters.period ? 'Which current period should I use?' : !parameters.comparePeriod ? 'Which comparison period should I use?' : null,
      scenario: parameters.assumptions ? null : 'What price change in basis points should I assume?',
    }, origins };
}
export function validateCalculationParameterDisclosure(value: unknown, parameters: ReviewedCalculationParameters, origins: CalculationParameterOrigins, path: string): void {
  const checked = shape(value, path, ['kind', 'period', 'comparePeriod', 'assumptions', 'missingInputClarifications', 'origins']);
  if (checked.kind !== 'owner-requested-calculation-parameters') fail(path + '.kind');
  if (checked.period !== null) period(checked.period, path + '.period');
  if (checked.comparePeriod !== null) period(checked.comparePeriod, path + '.comparePeriod');
  if (checked.assumptions !== null) {
    const assumption = shape(checked.assumptions, path + '.assumptions', ['origin', 'label', 'priceChangeBps']);
    if (assumption.origin !== 'owner-requested' || assumption.label !== ownerRequestedScenarioLabel) fail(path + '.assumptions');
    price(assumption.priceChangeBps, path + '.assumptions.priceChangeBps');
  }
  const missing = shape(checked.missingInputClarifications, path + '.missingInputClarifications', ['change', 'scenario']);
  for (const key of ['change', 'scenario']) if (missing[key] !== null && typeof missing[key] !== 'string') fail(path + '.missingInputClarifications.' + key);
  validateCalculationParameterOrigins(checked.origins, parameters, path + '.origins');
  const expected = calculationParameterDisclosure(parameters, origins);
  if (JSON.stringify(checked) !== JSON.stringify(expected)) fail(path);
}
