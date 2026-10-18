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

/** Owner-typed monthly limit in US dollars ('5', '12.50') to micros ('12500000'). 0.01 to 1000. */
export function monthlyCapMicros(value: unknown): MicroString {
  const message = 'Monthly limit must be an amount from 0.01 to 1000 US dollars, like 5 or 12.50.';
  check(typeof value === 'string', 'INVALID_AMOUNT', message);
  const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(value.trim());
  check(match, 'INVALID_AMOUNT', message);
  const micros = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
  check(micros >= 10_000n && micros <= 1_000_000_000n, 'INVALID_AMOUNT', message);
  return String(micros);
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
