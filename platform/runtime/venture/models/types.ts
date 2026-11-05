// Chausar venture launcher, package P2 (models): record shapes and shared constants.
//
// The record shapes are the contract types. The route kind is stored as `routeKind`, because
// `kind` is the record kind that the vault and listRecords use.
import type {
  ModelCallRecord, ModelConnectionRecord, ModelConnectionView, ModelRouteKind,
} from '../contracts.ts';

export type ConnectionRecord = ModelConnectionRecord;
export type ConnectionView = ModelConnectionView;
export type CallRecord = ModelCallRecord;

/**
 * D2: inputTokens is always the uncached input. cachedInputTokens (prompt cache reads) and cacheWriteTokens (prompt cache
 * writes) appear only when the provider reported more than zero of them, so a call without caching keeps its old shape.
 */
export type Usage = { inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number };
/** Whose usage report it is: the field names and what input_tokens includes differ. */
export type UsageProvider = 'anthropic' | 'openai' | 'claude-cli' | 'codex-cli';

/**
 * What a route parser makes of one provider answer. Usage is kept even on failure, so spend is counted. answeredBy
 * (4H1, H36): the model the answer named, when it named one Chausar can read as a model id.
 */
/** cause (Ink v2 wave 4, 4F2): the transport's class of a failure, such as 'not-connected', when it named one. */
/** said (A2): what a command-line tool printed when it failed, screened for secrets and cut short; kept on the record, never shown as the owner's words. */
export type Parsed = ({ ok: true; value: unknown; usage: Usage | null } | { ok: false; code: string; message: string; usage: Usage | null; cause?: string; said?: string }) & { answeredBy?: string | null };

/** What a call record says when the provider's answer named no model (4H1, H36). Never a guess. */
export const NOT_REPORTED = 'not reported';

export const HTTP_TIMEOUT_MS = 90_000;
export const PROCESS_TIMEOUT_MS = 150_000;
export const VERSION_CHECK_TIMEOUT_MS = 10_000;
/** A call still dispatching after this long is reported as failed and no longer reserves budget. */
export const STALE_DISPATCH_MS = 10 * 60_000;
export const STALE_DISPATCH_MESSAGE = 'The result was never recorded. Chausar does not retry on its own.';
export const RESPONSE_LIMIT_BYTES = 1_048_576;

export const ENDPOINTS: Readonly<Record<ModelRouteKind, string>> = Object.freeze({
  'anthropic-messages': 'https://api.anthropic.com/v1/messages',
  'openai-responses': 'https://api.openai.com/v1/responses',
  'claude-cli': 'cli://claude',
  'codex-cli': 'cli://codex',
  template: 'chausar://built-in-templates',
});

export function validTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Usage from a provider's report, or null when it is missing or malformed. Anthropic and the Claude command line report
 * cache_read_input_tokens and cache_creation_input_tokens beside input_tokens (the uncached part). OpenAI reports
 * input_tokens_details.cached_tokens and Codex cached_input_tokens inside input_tokens, so those are taken out of it:
 * input means the uncached part on every route.
 */
export function readUsage(value: unknown, provider: UsageProvider): Usage | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;
  if (!validTokenCount(usage.input_tokens) || !validTokenCount(usage.output_tokens)) return null;
  const optional = (tokens: unknown) => (tokens === undefined || tokens === null ? 0 : validTokenCount(tokens) ? tokens : -1);
  let input = usage.input_tokens, read = 0, write = 0;
  if (provider === 'anthropic' || provider === 'claude-cli') {
    read = optional(usage.cache_read_input_tokens); write = optional(usage.cache_creation_input_tokens);
  } else {
    const details = usage.input_tokens_details;
    read = optional(provider === 'openai' ? (details && typeof details === 'object' ? (details as Record<string, unknown>).cached_tokens : undefined) : usage.cached_input_tokens);
    input -= Math.max(read, 0);
  }
  if (read < 0 || write < 0 || input < 0) return null;
  return { inputTokens: input, outputTokens: usage.output_tokens, ...(read > 0 ? { cachedInputTokens: read } : {}), ...(write > 0 ? { cacheWriteTokens: write } : {}) };
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
