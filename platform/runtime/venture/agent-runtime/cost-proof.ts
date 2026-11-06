import { check, type State } from '../../contracts.ts';
import type { SpendRate, SumReceiptSubject, VentureRecord } from '../contracts.ts';
import { formatMicros, listRecords } from '../records.ts';
import type { SumPlan } from '../money/sums.ts';
import type { AgentUsage } from './driver-types.ts';
const valid = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
/** Reported tokens, exact saved prices and integer micro-USD. Reasoning tokens already belong to output. */
export function priceAgentUsage(rate: SpendRate, usage: AgentUsage, provider: 'codex' | 'claude', model: string): string {
  check(usage.source === 'provider-reported' && usage.model === model && rate.model === model, 'SPEND_UNPRICED', 'The reported model does not match this saved price. Its cost stays held.');
  const read = usage.cachedInputTokens ?? 0, write = usage.cacheWriteTokens ?? 0;
  check([usage.inputTokens, usage.outputTokens, read, write].every(valid), 'MODEL_FAILED', 'The provider reported token counts Chausar cannot read.');
  const input = provider === 'codex' ? usage.inputTokens - read - write : usage.inputTokens;
  check(input >= 0, 'MODEL_FAILED', 'The provider reported inconsistent input token counts.');
  const entries = [[input, rate.inputMicrosPerMillion], [usage.outputTokens, rate.outputMicrosPerMillion], [read, rate.cacheReadMicrosPerMillion], [write, rate.cacheWriteMicrosPerMillion]] as const;
  let numerator = 0n;
  for (const [tokens, price] of entries) {
    if (!tokens) continue;
    check(typeof price === 'string' && /^(0|[1-9][0-9]{0,14})$/.test(price), 'SPEND_UNPRICED', 'A reported token category has no saved price. Its cost stays held.');
    numerator += BigInt(tokens) * BigInt(price);
  }
  return String((numerator + 999999n) / 1000000n);
}
export function agentCostPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'agent-cost' }>): SumPlan {
  const spend = listRecords(state, 'venture-spend', venture.id).find(row => row.id === subject.spendId);
  const proof = spend?.agentUsage, rate = spend?.rate;
  const amount = proof && rate ? priceAgentUsage(rate, proof.usage, proof.provider, proof.model) : null;
  return { subject, currency: 'USD', unit: 'micros', words: { label: 'AI usage cost', one: 'provider usage report', many: 'provider usage reports', none: 'No priced usage report.' },
    estimateWords: 'The model price is unconfirmed.', addends: amount === null ? [] : [{ recordId: spend!.id,
      label: `${proof!.model}: ${proof!.usage.inputTokens} input and ${proof!.usage.outputTokens} output tokens; cache reads ${proof!.usage.cachedInputTokens ?? 0}, cache writes ${proof!.usage.cacheWriteTokens ?? 0}. Saved rates in micro-USD per million: input ${rate!.inputMicrosPerMillion}, output ${rate!.outputMicrosPerMillion}, cache read ${rate!.cacheReadMicrosPerMillion ?? 'not priced'}, cache write ${rate!.cacheWriteMicrosPerMillion ?? 'not priced'}. Multiply each priced token category, add, divide by one million and round up once.`, amount, display: formatMicros(amount), estimate: rate!.confirmed !== true }] };
}
