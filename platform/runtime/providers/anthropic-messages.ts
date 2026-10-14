/**
 * Anthropic Messages API route (`POST /v1/messages`), raw HTTP so the receipt holds the exact body.
 * Structured output uses `output_config.format` with a JSON schema; no tools are declared, so the
 * model cannot call one. Reference: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 */
import { check } from '../contracts.ts';

export const ANTHROPIC_MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

export function anthropicMessagesPayload(route: { model: string; maxOutputTokens?: number }, instructions: string, input: string, schema: unknown): string {
  return JSON.stringify({ model: route.model, max_tokens: route.maxOutputTokens, system: instructions,
    messages: [{ role: 'user', content: input }], output_config: { format: { type: 'json_schema', schema } } });
}

/** Provider-specific credential headers. Bearer for every other HTTP route. */
export function providerAuthHeaders(kind: string, key: string): Record<string, string> {
  return kind === 'anthropic-messages' ? { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION } : { Authorization: `Bearer ${key}` };
}

export function parseAnthropicMessagesOutput(data: any): { value: unknown; usage?: any } {
  check(data.type !== 'error' && !data.error, 'MODEL_FAILED', 'The provider returned an error rather than a completed response.');
  check(data.stop_reason !== 'refusal', 'MODEL_REFUSAL', 'The provider refused this response.');
  check(Array.isArray(data.content), 'INVALID_PLAN', 'The model returned an invalid content list.');
  check(data.stop_reason !== 'tool_use' && data.content.every((block: any) => block && ['text', 'thinking', 'redacted_thinking'].includes(block.type)),
    'MODEL_TOOL_ATTEMPT', 'The model returned a tool or action.');
  check(data.stop_reason === 'end_turn' || data.stop_reason === 'stop_sequence', 'MODEL_INCOMPLETE', 'The provider did not complete this response.');
  const text = data.content.filter((block: any) => block.type === 'text').map((block: any) => {
    check(typeof block.text === 'string', 'INVALID_PLAN', 'The model returned invalid plan text.'); return block.text;
  }).join('');
  return { value: JSON.parse(text), usage: data.usage };
}
