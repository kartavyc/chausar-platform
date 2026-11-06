// The OpenAI-shaped routes: the Responses API (openai-responses, and the managed route that speaks it) and Chat
// Completions (openai-compatible). Reading their answers (split out of gateway.ts, D11).
import { check } from '../../contracts.ts';
import { isRecord } from '../requests.ts';

/** A Responses API answer: completed, only message and reasoning items, final output text only, no refusal or tool. */
export function parseOpenAiResponsesOutput(data: any): { value: unknown; usage?: any } {
  check(!data.error, 'MODEL_FAILED', 'The provider returned an error rather than a completed response.');
  check(data.status === undefined || data.status === 'completed', 'MODEL_INCOMPLETE', 'The provider did not complete this response.');
  const output: unknown = data.output;
  check(output == null || Array.isArray(output), 'INVALID_PLAN', 'The model returned an invalid output list.');
  const items: unknown[] = output ?? [];
  check(items.every(item => isRecord(item) && (item.type === 'message' || item.type === 'reasoning')), 'MODEL_TOOL_ATTEMPT', 'The model returned a tool or action.');
  const messageText = items.flatMap(item => {
    check(isRecord(item), 'INVALID_PLAN', 'The model returned an invalid output item.');
    const content: unknown = item.content;
    check(content == null || Array.isArray(content), 'INVALID_PLAN', 'The model returned invalid message content.');
    const chunks: unknown[] = content ?? [];
    return chunks.flatMap(chunk => {
      check(isRecord(chunk), 'INVALID_PLAN', 'The model returned invalid message content.');
      check(chunk.type !== 'refusal', 'MODEL_REFUSAL', 'The provider refused this response.');
      check(chunk.type === 'output_text', 'INVALID_PLAN', 'Only final structured text is accepted from this provider.');
      check(typeof chunk.text === 'string', 'INVALID_PLAN', 'The model returned invalid plan text.');
      return [chunk.text];
    });
  }).join('');
  const text: unknown = data.output_text || messageText;
  if (data.output_text && messageText) check(data.output_text === messageText, 'INVALID_PLAN', 'Final structured text disagrees with the response messages.');
  check(typeof text === 'string', 'INVALID_PLAN', 'The model returned invalid plan text.');
  return { value: JSON.parse(text), usage: data.usage };
}

/** A Chat Completions answer: one choice, no tool, no refusal, finished with stop. */
export function parseOpenAiCompatibleOutput(data: any): { value: unknown; usage?: any } {
  check(!data.error, 'MODEL_FAILED', 'The provider returned an error rather than a completed response.');
  check(data.choices?.length === 1 && !data.choices[0].message?.tool_calls?.length && !data.choices[0].message?.function_call, 'MODEL_TOOL_ATTEMPT', 'The model must return a single plan without tools.');
  const choice = data.choices[0];
  check(choice.finish_reason !== 'content_filter' && !choice.message?.refusal, 'MODEL_REFUSAL', 'The provider refused this response.');
  check(choice.finish_reason === undefined || choice.finish_reason === 'stop', 'MODEL_INCOMPLETE', 'The provider did not complete this response.');
  return { value: JSON.parse(choice.message.content), usage: data.usage };
}
