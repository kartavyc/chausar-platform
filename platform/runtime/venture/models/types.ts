// Chausar venture launcher, package P2 (models): record shapes and shared constants.
//
// Why local record types: in contracts.ts, ModelConnectionRecord and ModelCallRecord each add
// `kind: ModelRouteKind` on top of RecordBase, whose `kind` is the record kind. The two literal
// types cannot both hold, so TypeScript reduces both record types to `never`. The vault needs
// `kind` to be the record kind, so this package stores the route kind as `routeKind` and keeps
// these local shapes until the integrator renames the contract field (see docs/venture/models.md).
import type {
  IsoTime, MicroString, ModelPresetId, ModelPurpose, ModelRouteKind, ModelTier, RecordBase,
} from '../contracts.ts';

export type ConnectionRecord = RecordBase<'venture-model-connection'> & {
  presetId: ModelPresetId;
  routeKind: ModelRouteKind;
  model: string | null;
  endpoint: string;
  tiers: ModelTier[];
  consentDigest: string;
  consentedAt: IsoTime;
  monthlyCapMicros: MicroString;
  status: 'connected' | 'disconnected';
};

export type ConnectionView = ConnectionRecord & { keyLoaded: boolean; usable: boolean; reason: string };

export type CallRecord = RecordBase<'venture-model-call'> & {
  purpose: ModelPurpose;
  tier: ModelTier;
  presetId: ModelPresetId;
  connectionId: string | null;
  routeKind: ModelRouteKind;
  model: string | null;
  consent: 'standing' | 'approved-preview';
  endpoint: string;
  payloadText: string;
  payloadDigest: string;
  payloadTruncated: boolean;
  containsClientData: boolean;
  status: 'preview' | 'dispatching' | 'completed' | 'failed' | 'expired';
  approvedDigest: string | null;
  approvedAt: IsoTime | null;
  approvedBy: string | null;
  estimatedMaxCostMicros: MicroString;
  priceConfirmed: boolean;
  usage: Usage | null;
  costMicros: MicroString | null;
  outputDigest: string | null;
  error: { code: string; message: string } | null;
  replay: boolean;
};

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
