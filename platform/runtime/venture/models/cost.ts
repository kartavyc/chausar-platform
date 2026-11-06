// Chausar venture launcher, package P2 (models): model costs, worked out by code in BigInt micro-USD.
// Token counts arrive as numbers from the provider; every amount is BigInt or decimal text.
import { check } from '../../contracts.ts';
import { formatMicros } from '../records.ts';
import type { MicroString, ModelPriceTable, ModelRouteKind } from '../contracts.ts';
import { validTokenCount, type Usage } from './types.ts';

const MICROS_PER_MILLION_TOKENS = 1_000_000n;

/** Cost of one call, rounded up to a whole micro: (in x inRate + out x outRate + 999999) / 1000000. '0' without a table. */
export function callCostMicros(usage: Usage, table: ModelPriceTable | null): MicroString {
  if (!table) return '0';
  check(validTokenCount(usage.inputTokens) && validTokenCount(usage.outputTokens), 'MODEL_FAILED', 'The provider reported token counts Chausar cannot read.');
  const total = BigInt(usage.inputTokens) * BigInt(table.inputMicrosPerMillion) + BigInt(usage.outputTokens) * BigInt(table.outputMicrosPerMillion);
  return String((total + MICROS_PER_MILLION_TOKENS - 1n) / MICROS_PER_MILLION_TOKENS);
}

/**
 * The most a call can cost before it is sent: input tokens counted as ceil(payloadChars / 2), which is well above
 * what any tokenizer produces for text, plus the full output allowance. '0' without a table.
 */
export function estimateMaxCostMicros(payloadChars: number, maxOutputTokens: number, table: ModelPriceTable | null): MicroString {
  if (!table) return '0';
  check(validTokenCount(payloadChars) && validTokenCount(maxOutputTokens), 'INVALID_VENTURE_REQUEST', 'The model request size is not a whole number.');
  const inputTokens = (BigInt(payloadChars) + 1n) / 2n;
  const total = inputTokens * BigInt(table.inputMicrosPerMillion) + BigInt(maxOutputTokens) * BigInt(table.outputMicrosPerMillion);
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

/** Owner-typed monthly limit of one AI connection in US dollars ('5', '12.50') to micros ('12500000'). 0.01 to 1000. */
export function monthlyCapMicros(value: unknown): MicroString {
  return usdToMicros(value, { field: 'Monthly limit', decimals: 2, min: '10000', max: '1000000000' });
}

export const ESTIMATE_WORDS = ' (estimate, price unconfirmed)';
export const OWN_PLAN_WORDS = ' (runs on your own plan)';

/** 'USD 0.0002', plus the estimate words for an unconfirmed table, or the own-plan words for a command-line tool. */
export function costDisplay(micros: MicroString, priceConfirmed: boolean, routeKind?: ModelRouteKind): string {
  const base = formatMicros(micros);
  if (!priceConfirmed) return base + ESTIMATE_WORDS;
  if (routeKind === 'claude-cli' || routeKind === 'codex-cli') return base + OWN_PLAN_WORDS;
  return base;
}
