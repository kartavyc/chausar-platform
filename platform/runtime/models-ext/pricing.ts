/**
 * Dated provider price table and rupee conversion. Prices are integer micro-dollars per million
 * tokens; the FX rate is integer paise per US dollar. All arithmetic is BigInt and rounds up, so a
 * shown cost is never below what the provider would bill at these published rates.
 */
import { check } from '../contracts.ts';

export type PriceEntry = { kind: string; model: string; inputUsdMicroPerMillion: string; outputUsdMicroPerMillion: string;
  asOf: string; source: string; verified: boolean };
export type FxSetting = { paisePerUsd: string; asOf: string; setBy: string };

const OPENAI = 'https://developers.openai.com/api/docs/pricing';
const ANTHROPIC = 'https://platform.claude.com/docs/en/about-claude/pricing';
const p = (kind: string, model: string, input: string, output: string, asOf: string, source: string, verified = true): PriceEntry =>
  ({ kind, model, inputUsdMicroPerMillion: input, outputUsdMicroPerMillion: output, asOf, source, verified });

/** Published standard-tier rates as read on the dates given. Change only with a new date and source. */
export const PRICE_TABLE: readonly PriceEntry[] = Object.freeze([
  p('openai-responses', 'gpt-5.6-sol', '4000000', '20000000', '2026-10-14', OPENAI),
  p('openai-responses', 'gpt-5.6-terra', '2000000', '12000000', '2026-10-14', OPENAI),
  p('openai-responses', 'gpt-5.6-luna', '200000', '1200000', '2026-10-14', OPENAI),
  p('openai-responses', 'gpt-5.5', '5000000', '30000000', '2026-10-14', OPENAI),
  p('openai-responses', 'gpt-5.4-mini', '750000', '4500000', '2026-10-14', OPENAI),
  p('anthropic-messages', 'claude-opus-5-5', '4000000', '20000000', '2026-10-06', ANTHROPIC),
  p('anthropic-messages', 'claude-sonnet-5-5', '2000000', '10000000', '2026-10-06', ANTHROPIC),
  p('anthropic-messages', 'claude-haiku-5-5', '100000', '500000', '2026-10-06', ANTHROPIC),
  // Read from a third-party listing; SubQ's own docs state only that output tokens are free.
  p('subq-snap', 'subq-snap-preview', '50000', '0', '2026-10-14', 'https://slashdot.org/software/p/SubQ-Snap/', false),
]);

export const DIGITS = /^\d{1,30}$/;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validPrice(input: any, kind: string, model: string, setBy: string): PriceEntry {
  check(input && typeof input === 'object' && Object.keys(input).every(k => ['inputUsdMicroPerMillion', 'outputUsdMicroPerMillion', 'asOf', 'source'].includes(k)),
    'INVALID_PRICE', 'A price has input and output rates, a date and a source.');
  check(DIGITS.test(input.inputUsdMicroPerMillion) && DIGITS.test(input.outputUsdMicroPerMillion), 'INVALID_PRICE', 'Rates are whole micro-dollars per million tokens.');
  check(typeof input.asOf === 'string' && DAY.test(input.asOf) && !Number.isNaN(Date.parse(input.asOf)), 'INVALID_PRICE', 'Give the date the price was read.');
  check(typeof input.source === 'string' && input.source.length > 0 && input.source.length <= 300, 'INVALID_PRICE', 'Name where the price was read.');
  return { kind, model, inputUsdMicroPerMillion: input.inputUsdMicroPerMillion, outputUsdMicroPerMillion: input.outputUsdMicroPerMillion,
    asOf: input.asOf, source: `${input.source} (entered by ${setBy})`, verified: false };
}

export function findPrice(table: readonly PriceEntry[], kind: string, model: string): PriceEntry | undefined {
  return table.find(entry => entry.kind === kind && entry.model === model)
    ?? table.find(entry => entry.model === model && (kind === 'managed' || kind === 'openai-compatible'));
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Paise per million tokens at a given FX rate. */
export function paisePerMillion(usdMicroPerMillion: string, fx: FxSetting): string {
  return String(ceilDiv(BigInt(usdMicroPerMillion) * BigInt(fx.paisePerUsd), 1000000n));
}

/** Rupee cost of one request in paise, rounded up. Mirrors the gateway's own token-cost rule. */
export function requestCostMinor(inputTokens: number, outputTokens: number, inputPerMillionMinor: string, outputPerMillionMinor: string): string {
  check(Number.isSafeInteger(inputTokens) && Number.isSafeInteger(outputTokens) && inputTokens >= 0 && outputTokens >= 0, 'INVALID_USAGE', 'Token counts are whole numbers.');
  return String(ceilDiv(BigInt(inputTokens) * BigInt(inputPerMillionMinor) + BigInt(outputTokens) * BigInt(outputPerMillionMinor), 1000000n));
}

/** Age of a dated entry in whole days, for the "checked on" line. */
export function ageDays(asOf: string, at = new Date()): number {
  return Math.floor((at.getTime() - Date.parse(`${asOf}T00:00:00Z`)) / 86400000);
}
