// Chausar venture launcher, package P2 (models): the Anthropic Messages route, as raw HTTPS through the transport.
// One route, no reroute: no thinking settings, sampling settings, tools or server-side fallbacks are sent.
// A refusal or a cut-off answer is recorded as an error; Chausar never retries or switches models on its own.
import type { ModelHttpResponse, ModelTask } from '../contracts.ts';
import { sanitizeSchema } from './schema.ts';
import { ENDPOINTS, isPlainRecord, readUsage, type Parsed } from './types.ts';

export const ANTHROPIC_URL = ENDPOINTS['anthropic-messages'];
export const ANTHROPIC_VERSION = '2023-06-01';

/** The exact request body. It never holds the key. Key order: model, max_tokens, system, messages, output_config. */
export function anthropicBody(model: string, task: ModelTask<unknown>): string {
  return JSON.stringify({
    model,
    max_tokens: task.maxOutputTokens,
    system: task.instructions,
    messages: [{ role: 'user', content: JSON.stringify(task.input) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: sanitizeSchema(task.schema) } },
  });
}

export function anthropicHeaders(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION };
}

export function httpFailure(status: number, provider: 'Anthropic' | 'OpenAI'): Parsed {
  if (status === 401 || status === 403) return { ok: false, code: 'MODEL_FAILED', message: `${provider} refused your key. Check it and connect again.`, usage: null };
  if (status === 429) return { ok: false, code: 'MODEL_FAILED', message: `${provider} is busy or your account limit was reached. Try again later.`, usage: null };
  return { ok: false, code: 'MODEL_FAILED', message: `${provider} returned an error (HTTP ${status}). Chausar did not retry it.`, usage: null };
}

/**
 * end_turn passes; max_tokens and any other stop reason are MODEL_INCOMPLETE; refusal is MODEL_REFUSAL.
 * Thinking blocks are skipped; the text blocks are joined and parsed as JSON (MODEL_OUTPUT_REJECTED when not JSON).
 */
export function parseAnthropic(response: ModelHttpResponse): Parsed {
  if (response.status !== 200) return httpFailure(response.status, 'Anthropic');
  let data: unknown;
  try { data = JSON.parse(response.body); } catch { return { ok: false, code: 'MODEL_FAILED', message: 'Anthropic sent an answer Chausar could not read.', usage: null }; }
  if (!isPlainRecord(data)) return { ok: false, code: 'MODEL_FAILED', message: 'Anthropic sent an answer Chausar could not read.', usage: null };
  const usage = readUsage(data.usage);
  if (data.stop_reason === 'refusal') return { ok: false, code: 'MODEL_REFUSAL', message: 'The model declined this request. Nothing was retried.', usage };
  if (data.stop_reason === 'max_tokens') return { ok: false, code: 'MODEL_INCOMPLETE', message: 'The model ran out of room before it finished. Nothing was retried.', usage };
  if (data.stop_reason !== 'end_turn') return { ok: false, code: 'MODEL_INCOMPLETE', message: 'The model stopped before it finished. Nothing was retried.', usage };
  if (!Array.isArray(data.content)) return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer had no text.', usage };
  const texts: string[] = [];
  for (const block of data.content) {
    if (!isPlainRecord(block)) return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer was not in the expected shape.', usage };
    if (block.type === 'thinking' || block.type === 'redacted_thinking') continue;
    if (block.type !== 'text' || typeof block.text !== 'string') return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answered with something other than text.', usage };
    texts.push(block.text);
  }
  if (!texts.length) return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer had no text.', usage };
  try { return { ok: true, value: JSON.parse(texts.join('')), usage }; } catch {
    return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer was not valid JSON.', usage };
  }
}
