import type { Fetch } from '../shared/module.ts';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type CompletionInput = { model: string; system?: string; messages: ChatMessage[]; maxOutputTokens: number; signal?: AbortSignal };
export type Completion = { text: string; inputTokens: number; outputTokens: number };
export interface ModelProvider { complete(input: CompletionInput): Promise<Completion> }

/**
 * The provider answered with an error status, so it produced nothing to bill. Any other failure (no answer,
 * a timeout, an unreadable success) leaves the outcome unknown. The message never carries the provider's text.
 */
export class ProviderFailed extends Error {
  readonly code = 'PROVIDER_FAILED'; readonly status: number;
  constructor(status: number) { super('PROVIDER_FAILED'); this.status = status; }
}
/** A success reply whose shape we cannot read: the provider may have billed for it. */
export class ProviderReplyInvalid extends Error { readonly code = 'PROVIDER_REPLY_INVALID'; constructor() { super('PROVIDER_REPLY_INVALID'); } }

const count = (value: unknown): number => { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ProviderReplyInvalid(); return value as number; };
async function post(fetch: Fetch, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  if (!response.ok) { await response.text().catch(() => ''); throw new ProviderFailed(response.status); }
  try { return JSON.parse(await response.text()); } catch { throw new ProviderReplyInvalid(); }
}

/** Anthropic Messages API. */
export function anthropicProvider(apiKey: string, fetch: Fetch): ModelProvider {
  return {
    async complete(input) {
      const body: Record<string, unknown> = { model: input.model, max_tokens: input.maxOutputTokens };
      if (input.system !== undefined) body.system = input.system;
      body.messages = input.messages.map(m => ({ role: m.role, content: m.content }));
      const reply = await post(fetch, 'https://api.anthropic.com/v1/messages', { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body, input.signal);
      if (!Array.isArray(reply?.content)) throw new ProviderReplyInvalid();
      const text = reply.content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('');
      return { text, inputTokens: count(reply.usage?.input_tokens), outputTokens: count(reply.usage?.output_tokens) };
    },
  };
}

/** OpenAI Responses API. */
export function openaiProvider(apiKey: string, fetch: Fetch): ModelProvider {
  return {
    async complete(input) {
      const body: Record<string, unknown> = { model: input.model, input: input.messages.map(m => ({ role: m.role, content: m.content })) };
      if (input.system !== undefined) body.instructions = input.system;
      body.max_output_tokens = input.maxOutputTokens;
      const reply = await post(fetch, 'https://api.openai.com/v1/responses', { authorization: `Bearer ${apiKey}` }, body, input.signal);
      let text: string;
      if (typeof reply?.output_text === 'string') text = reply.output_text;
      else if (Array.isArray(reply?.output)) text = reply.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
        .filter((part: any) => (part?.type === 'output_text' || part?.type === 'text') && typeof part.text === 'string').map((part: any) => part.text).join('');
      else throw new ProviderReplyInvalid();
      return { text, inputTokens: count(reply.usage?.input_tokens), outputTokens: count(reply.usage?.output_tokens) };
    },
  };
}
