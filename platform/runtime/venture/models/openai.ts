// Chausar venture launcher, package P2 (models): the OpenAI Responses route, as raw HTTPS through the transport.
// Parsing follows the openai-responses branch of parseProviderOutput in gateway.ts: a completed status,
// message items only, and a refusal chunk is MODEL_REFUSAL.
import type { ModelHttpResponse, ModelTask } from '../contracts.ts';
import { httpFailure } from './anthropic.ts';
import { sanitizeSchema } from './schema.ts';
import { ENDPOINTS, isPlainRecord, readUsage, type Parsed } from './types.ts';

export const OPENAI_URL = ENDPOINTS['openai-responses'];

/** The exact request body. It never holds the key. The model id comes from the connection (the owner may type it). */
export function openaiBody(model: string, task: ModelTask<unknown>): string {
  return JSON.stringify({
    model,
    instructions: task.instructions,
    input: JSON.stringify(task.input),
    max_output_tokens: task.maxOutputTokens,
    store: false,
    tools: [],
    tool_choice: 'none',
    text: { format: { type: 'json_schema', name: task.schemaName, schema: sanitizeSchema(task.schema), strict: true } },
  });
}

export function openaiHeaders(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
}

export function parseOpenAI(response: ModelHttpResponse): Parsed {
  if (response.status !== 200) return httpFailure(response.status, 'OpenAI');
  let data: unknown;
  try { data = JSON.parse(response.body); } catch { return { ok: false, code: 'MODEL_FAILED', message: 'OpenAI sent an answer Chausar could not read.', usage: null }; }
  if (!isPlainRecord(data)) return { ok: false, code: 'MODEL_FAILED', message: 'OpenAI sent an answer Chausar could not read.', usage: null };
  const usage = readUsage(data.usage);
  if (data.error) return { ok: false, code: 'MODEL_FAILED', message: 'OpenAI returned an error instead of an answer. Chausar did not retry it.', usage };
  if (data.status !== undefined && data.status !== 'completed') return { ok: false, code: 'MODEL_INCOMPLETE', message: 'The model stopped before it finished. Nothing was retried.', usage };
  const output = data.output ?? [];
  if (!Array.isArray(output)) return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer was not in the expected shape.', usage };
  const texts: string[] = [];
  for (const item of output) {
    if (!isPlainRecord(item)) return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer was not in the expected shape.', usage };
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message') return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model tried to use a tool or take an action.', usage };
    const content = item.content ?? [];
    if (!Array.isArray(content)) return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer was not in the expected shape.', usage };
    for (const chunk of content) {
      if (!isPlainRecord(chunk)) return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer was not in the expected shape.', usage };
      if (chunk.type === 'refusal') return { ok: false, code: 'MODEL_REFUSAL', message: 'The model declined this request. Nothing was retried.', usage };
      if (chunk.type !== 'output_text' || typeof chunk.text !== 'string') return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answered with something other than text.', usage };
      texts.push(chunk.text);
    }
  }
  const messageText = texts.join('');
  const outputText = typeof data.output_text === 'string' ? data.output_text : '';
  if (outputText && messageText && outputText !== messageText) return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer disagreed with itself.', usage };
  const text = outputText || messageText;
  if (!text) return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer had no text.', usage };
  try { return { ok: true, value: JSON.parse(text), usage }; } catch {
    return { ok: false, code: 'MODEL_OUTPUT_REJECTED', message: 'The model answer was not valid JSON.', usage };
  }
}
