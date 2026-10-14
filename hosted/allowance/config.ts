import type { Env, Fetch } from '../shared/module.ts';
import { HostedError } from '../shared/errors.ts';
import { parsePricing, type PricingTable } from './pricing.ts';
import { anthropicProvider, openaiProvider, type ModelProvider } from './providers.ts';

/**
 * ANTHROPIC_API_KEY, OPENAI_API_KEY: provider keys held only on the server. A missing key leaves that route
 * absent (`PROVIDER_NOT_CONFIGURED`). ALLOWANCE_PRICING_JSON: the `PricingTable`; unset means every request
 * refuses `PRICING_NOT_SET`. A malformed table stops the server at start (`PRICING_INVALID`).
 */
export type AllowanceConfig = { anthropicApiKey: string | null; openaiApiKey: string | null; pricing: PricingTable | null };
export function allowanceConfig(env: Env): AllowanceConfig {
  const key = (value: string | undefined) => value?.trim() ? value.trim() : null;
  const raw = env.ALLOWANCE_PRICING_JSON?.trim();
  let pricing: PricingTable | null = null;
  if (raw) {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new HostedError('PRICING_INVALID', 'The pricing table is not valid JSON.', 500); }
    pricing = parsePricing(value);
  }
  return { anthropicApiKey: key(env.ANTHROPIC_API_KEY), openaiApiKey: key(env.OPENAI_API_KEY), pricing };
}
export function allowanceProviders(config: AllowanceConfig, fetch: Fetch): { anthropic?: ModelProvider; openai?: ModelProvider } {
  return {
    ...(config.anthropicApiKey ? { anthropic: anthropicProvider(config.anthropicApiKey, fetch) } : {}),
    ...(config.openaiApiKey ? { openai: openaiProvider(config.openaiApiKey, fetch) } : {}),
  };
}
