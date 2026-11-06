// The local Ollama route: reading its answer (split out of gateway.ts, D11).
import { check } from '../../contracts.ts';

/** An Ollama answer: no error, refusal, unfinished state or tool call; the message content is the JSON. */
export function parseOllamaOutput(data: any): { value: unknown; usage?: any } {
  check(!data.error, 'MODEL_FAILED', 'The provider returned an error rather than a completed response.');
  check(!data.message?.refusal, 'MODEL_REFUSAL', 'The provider refused this response.');
  // Older compatible endpoints omit terminal metadata; explicit nonterminal
  // or unsupported states must never admit even syntactically valid JSON.
  check((data.done === undefined || data.done === true) && (data.done_reason === undefined || data.done_reason === 'stop'),
    'MODEL_INCOMPLETE', 'The provider did not complete this response.');
  check(!data.message?.tool_calls?.length && !data.message?.function_call, 'MODEL_TOOL_ATTEMPT', 'The model requested a tool.');
  return { value: JSON.parse(data.message?.content || data.response), usage: { input_tokens: data.prompt_eval_count, output_tokens: data.eval_count } };
}
