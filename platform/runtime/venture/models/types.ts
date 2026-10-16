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

export type Usage = { inputTokens: number; outputTokens: number };

/** What a route parser makes of one provider answer. Usage is kept even on failure, so spend is counted. */
export type Parsed = { ok: true; value: unknown; usage: Usage | null } | { ok: false; code: string; message: string; usage: Usage | null };

export const HTTP_TIMEOUT_MS = 90_000;
export const PROCESS_TIMEOUT_MS = 150_000;
export const VERSION_CHECK_TIMEOUT_MS = 10_000;
/** A call still dispatching after this long is reported as failed and no longer reserves budget. */
export const STALE_DISPATCH_MS = 10 * 60_000;
export const PREVIEW_TTL_MS = 30 * 60_000;
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

/** Usage from a provider's { input_tokens, output_tokens } object, or null when it is missing or malformed. */
export function readUsage(value: unknown): Usage | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;
  if (!validTokenCount(usage.input_tokens) || !validTokenCount(usage.output_tokens)) return null;
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
