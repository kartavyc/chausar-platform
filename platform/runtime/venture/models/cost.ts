// Chausar venture launcher, package P2 (models): model costs, worked out by code in BigInt micro-USD.
// Token counts arrive as numbers from the provider; every amount is BigInt or decimal text.
import { check } from '../../contracts.ts';
import { formatCost } from '../../owner-format.ts';
import type { MicroString, ModelPriceTable, ModelRouteKind } from '../contracts.ts';
import { validTokenCount, type Usage } from './types.ts';

const MICROS_PER_MILLION_TOKENS = 1_000_000n;

/**
 * Cost of one call, rounded up once to a whole micro: each reported token kind (uncached input, output, cache reads,
 * cache writes) times its own saved rate, added, then (total + 999999) / 1000000. '0' without a table (the owner's own
 * plan). D2: a cache kind the provider reported with no saved rate leaves the cost held (SPEND_UNPRICED), as
 * priceAgentUsage does; it is never priced as plain input.
 */
export function callCostMicros(usage: Usage, table: ModelPriceTable | null): MicroString {
  if (!table) return '0';
  const read = usage.cachedInputTokens ?? 0, write = usage.cacheWriteTokens ?? 0;
  check([usage.inputTokens, usage.outputTokens, read, write].every(validTokenCount), 'MODEL_FAILED', 'The provider reported token counts Chausar cannot read.');
  const entries = [[usage.inputTokens, table.inputMicrosPerMillion], [usage.outputTokens, table.outputMicrosPerMillion],
    [read, table.cacheReadMicrosPerMillion], [write, table.cacheWriteMicrosPerMillion]] as const;
  let total = 0n;
  for (const [tokens, rate] of entries) {
    if (!tokens) continue;
    check(typeof rate === 'string' && /^(0|[1-9][0-9]{0,14})$/.test(rate), 'SPEND_UNPRICED', 'A reported token category has no saved price. Its cost stays held.');
    total += BigInt(tokens) * BigInt(rate);
  }
  return String((total + MICROS_PER_MILLION_TOKENS - 1n) / MICROS_PER_MILLION_TOKENS);
}

/** D2: the cost of one call, or null while it is held (a reported cache kind has no saved rate). */
export function callCostOrHeld(usage: Usage, table: ModelPriceTable | null): MicroString | null {
  try { return callCostMicros(usage, table); } catch (error) {
    if ((error as { code?: unknown })?.code === 'SPEND_UNPRICED') return null;
    throw error;
  }
}

/**
 * D3 fix: what a finished call record counts as. Its cost when priced; its reservation (estimatedMaxCostMicros) when
 * the cost is held, that is null beside reported usage, the figure its spend row keeps; null only when the call never
 * got a price (no usage: refused before it went, or no answer came). A held call is never counted as free.
 */
export function recordedCallMicros(call: { costMicros?: unknown; usage?: unknown; estimatedMaxCostMicros?: unknown } | null | undefined): MicroString | null {
  const micros = /^\d{1,18}$/;
  if (typeof call?.costMicros === 'string') return micros.test(call.costMicros) ? call.costMicros : null;
  if (!call || call.costMicros !== null || !call.usage || typeof call.usage !== 'object') return null;
  return typeof call.estimatedMaxCostMicros === 'string' && micros.test(call.estimatedMaxCostMicros) ? call.estimatedMaxCostMicros : null;
}

/**
 * The most a call can cost before it is sent: input tokens counted as ceil(payloadChars / 2), which is well above
 * what the original estimate allows for text, plus the full output allowance. Each input token reserves
 * the highest saved input/cache rate, so a premium cache write cannot evade the spend cap. '0' without a table.
 */
export function estimateMaxCostMicros(payloadChars: number, maxOutputTokens: number, table: ModelPriceTable | null): MicroString {
  if (!table) return '0';
  check(validTokenCount(payloadChars) && validTokenCount(maxOutputTokens), 'INVALID_VENTURE_REQUEST', 'The model request size is not a whole number.');
  const inputTokens = (BigInt(payloadChars) + 1n) / 2n;
  const inputRate = [table.inputMicrosPerMillion, table.cacheReadMicrosPerMillion, table.cacheWriteMicrosPerMillion]
    .filter((rate): rate is string => rate !== undefined)
    .reduce((highest, rate) => BigInt(rate) > highest ? BigInt(rate) : highest, 0n);
  const total = inputTokens * inputRate + BigInt(maxOutputTokens) * BigInt(table.outputMicrosPerMillion);
  return String((total + MICROS_PER_MILLION_TOKENS - 1n) / MICROS_PER_MILLION_TOKENS);
}

/**
 * The one parser for a figure the owner types in US dollars ('20', '12.50', '0.000075'), as whole micro units in
 * BigInt. decimals: how many places it takes (two for limits, six for rates); min and max: its range in micro units,
 * both inclusive. US dollars because that is what the AI providers bill and what the spend ledger counts in; Chausar
 * has no exchange rate, so it never converts rupees on its own.
 */
export function usdToMicros(value: unknown, options: { field: string; decimals: 2 | 6; min?: MicroString; max?: MicroString }): MicroString {
  const { field, decimals, min, max } = options;
  const dollars = (micros: MicroString) => microsAsUsd(micros).replace(/\.00$/, '');
  const message = min !== undefined && max !== undefined ? `${field} must be an amount from ${dollars(min)} to ${dollars(max)} US dollars, like 5 or 12.50.`
    : decimals === 2 ? `${field} must be an amount in US dollars with at most two decimals, like 20 or 12.50.`
      : `${field} must be an amount in US dollars with at most six decimals, like 3, 0.25 or 0.000075.`;
  check(typeof value === 'string', 'INVALID_AMOUNT', message);
  const match = (decimals === 2 ? /^(\d{1,7})(?:\.(\d{1,2}))?$/ : /^(\d{1,7})(?:\.(\d{1,6}))?$/).exec(value.trim());
  check(match, 'INVALID_AMOUNT', message);
  const micros = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
  check((min === undefined || micros >= BigInt(min)) && (max === undefined || micros <= BigInt(max)), 'INVALID_AMOUNT', message);
  return String(micros);
}

/** Micro units as the US dollars the owner types: two decimals at least, more only when the figure has them. */
export function microsAsUsd(micros: MicroString): string {
  const value = BigInt(micros);
  const fraction = String(value % 1_000_000n).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${value / 1_000_000n}.${fraction}`;
}

/** Owner-typed monthly limit of one AI connection, within the shared money representation. */
export function monthlyCapMicros(value: unknown): MicroString {
  return usdToMicros(value, { field: 'Monthly limit', decimals: 2, min: '10000' });
}

// B2: the owner form's words for an unconfirmed price, the same as formatCost's.
export const ESTIMATE_WORDS = ' (estimate)';
export const OWN_PLAN_WORDS = ' (runs on your own plan)';

/**
 * An AI cost in the owner form (one-shot B2): "$0.42", "under $0.01", " (estimate)" for an unconfirmed table, "On your
 * own AI plan" for a command-line tool that charged nothing, "Free" for nothing spent on a template or with no route.
 * The exact "USD 0.0002" stays on the receipt (records.ts formatMicros).
 */
export function costDisplay(micros: MicroString, priceConfirmed: boolean, routeKind?: ModelRouteKind): string {
  const ownPlan = routeKind === 'claude-cli' || routeKind === 'codex-cli';
  // An unconfirmed price belongs to a priced route, so nothing spent there is "$0.00 (estimate)", never "Free (estimate)".
  const paidCalls = !ownPlan && routeKind !== 'template' && (routeKind !== undefined || !priceConfirmed);
  const words = formatCost(micros, { ownPlan, paidCalls, estimate: !priceConfirmed });
  return ownPlan && BigInt(micros) > 0n ? words + OWN_PLAN_WORDS : words;
}
