import { check } from '../shared/errors.ts';

export const ROUTES = ['anthropic', 'openai'] as const;
export type ModelRoute = typeof ROUTES[number];
export type PricedModel = { route: ModelRoute; model: string; inputUsdMicrosPerMillionTokens: string; outputUsdMicrosPerMillionTokens: string };
/**
 * Provider list prices, copied by a person from the provider's price page on `checkedOn` (named in `source`),
 * with the rupee rate used. Every number is a whole-number string; arithmetic is BigInt only.
 * `fxPaisePerUsd` is paise per US dollar (for example "8450" for 84.50 rupees).
 */
export type PricingTable = { checkedOn: string; source: string; fxPaisePerUsd: string; models: PricedModel[] };

const WHOLE = /^(0|[1-9][0-9]{0,17})$/;
export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const bad = (message: string) => check(false, 'PRICING_INVALID', message, 500);

export function parsePricing(value: unknown): PricingTable {
  const table = value as PricingTable;
  if (!table || typeof table !== 'object' || Array.isArray(table)) bad('The pricing table is not an object.');
  for (const key of Object.keys(table)) if (!['checkedOn', 'source', 'fxPaisePerUsd', 'models'].includes(key)) bad('The pricing table has an unexpected field.');
  if (typeof table.checkedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(table.checkedOn) || new Date(`${table.checkedOn}T00:00:00Z`).toISOString().slice(0, 10) !== table.checkedOn) bad('The pricing date is not valid.');
  if (typeof table.source !== 'string' || !table.source.trim() || table.source.length > 300) bad('The pricing source is missing.');
  if (typeof table.fxPaisePerUsd !== 'string' || !WHOLE.test(table.fxPaisePerUsd) || table.fxPaisePerUsd === '0') bad('The rupee rate is not valid.');
  if (!Array.isArray(table.models) || table.models.length < 1 || table.models.length > 200) bad('The pricing table lists no models.');
  const seen = new Set<string>();
  const models = table.models.map(model => {
    if (!model || typeof model !== 'object') bad('A priced model is not valid.');
    for (const key of Object.keys(model)) if (!['route', 'model', 'inputUsdMicrosPerMillionTokens', 'outputUsdMicrosPerMillionTokens'].includes(key)) bad('A priced model has an unexpected field.');
    if (!ROUTES.includes(model.route) || typeof model.model !== 'string' || !MODEL_NAME.test(model.model)) bad('A priced model is not valid.');
    if (![model.inputUsdMicrosPerMillionTokens, model.outputUsdMicrosPerMillionTokens].every(n => typeof n === 'string' && WHOLE.test(n))) bad('A model price is not a whole number.');
    const key = `${model.route}\0${model.model}`; if (seen.has(key)) bad('A model is priced twice.'); seen.add(key);
    return { route: model.route, model: model.model, inputUsdMicrosPerMillionTokens: model.inputUsdMicrosPerMillionTokens, outputUsdMicrosPerMillionTokens: model.outputUsdMicrosPerMillionTokens };
  });
  return Object.freeze({ checkedOn: table.checkedOn, source: table.source, fxPaisePerUsd: table.fxPaisePerUsd, models });
}

const MILLION_SQUARED = 1_000_000n * 1_000_000n;
/** Whole paise, rounded up: ceil((in * inMicros + out * outMicros) * fx / 10^12). */
export function costPaise(price: PricedModel, fxPaisePerUsd: string, inputTokens: number | bigint, outputTokens: number | bigint): bigint {
  const input = BigInt(inputTokens), output = BigInt(outputTokens);
  check(input >= 0n && output >= 0n, 'TOKENS_INVALID', 'Token counts cannot be negative.', 500);
  const numerator = (input * BigInt(price.inputUsdMicrosPerMillionTokens) + output * BigInt(price.outputUsdMicrosPerMillionTokens)) * BigInt(fxPaisePerUsd);
  return (numerator + MILLION_SQUARED - 1n) / MILLION_SQUARED;
}
