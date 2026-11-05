// Reading a provider answer by route, and the cost and retention of a model receipt (split out of gateway.ts, D11).
import { check, ChausarError, type State } from '../contracts.ts';
import { parseCodexCliOutput } from '../providers/codex-cli.ts';
import type { RouteKind } from './model-request.ts';
import { isRecord } from './requests.ts';
import { parseClaudeCliOutput } from './providers/cli.ts';
import { parseOllamaOutput } from './providers/ollama.ts';
import { parseOpenAiResponsesOutput, parseOpenAiCompatibleOutput } from './providers/openai.ts';

/** One provider answer, bounded, read by its route's parser; anything but a Chausar error becomes INVALID_PLAN. */
export function parseProviderOutput(kind: RouteKind, body: string): { value: unknown; usage?: any } {
  check(Buffer.byteLength(body) <= 1048576, 'RESPONSE_TOO_LARGE', 'The model returned too much data.');
  let data: any;
  try {
    if (kind === 'codex-cli') return parseCodexCliOutput(body);
    data = JSON.parse(body);
    check(Boolean(isRecord(data)), 'INVALID_PLAN', 'The provider returned an invalid response.');
    if (kind === 'claude-cli') return parseClaudeCliOutput(data);
    if (kind === 'ollama') return parseOllamaOutput(data);
    if (kind === 'openai-responses' || kind === 'managed') return parseOpenAiResponsesOutput(data);
    return parseOpenAiCompatibleOutput(data);
  } catch (error) { if (error instanceof ChausarError) throw error; throw new ChausarError('INVALID_PLAN', 'The model did not return valid plan JSON.'); }
}

export function actualCost(route: any, usage: any): string | null {
  const input = usage?.input_tokens ?? usage?.prompt_tokens; const output = usage?.output_tokens ?? usage?.completion_tokens;
  if (!route.inputPerMillionMinor || !route.outputPerMillionMinor || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) return null;
  return String((BigInt(input) * BigInt(route.inputPerMillionMinor) + BigInt(output) * BigInt(route.outputPerMillionMinor) + 999999n) / 1000000n);
}

export function modelReceiptRetained(state: State, receipt: any): boolean {
  const at: unknown = receipt.createdAt ?? receipt.at;
  const days = state.policy.retentionDays;
  if (typeof at !== 'string' || !Number.isFinite(days) || days < 1) return false;
  const time = Date.parse(at);
  return Number.isFinite(time) && new Date(time).toISOString() === at && time >= Date.now() - days * 86400000;
}
