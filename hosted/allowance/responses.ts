/**
 * `POST /v1/allowance/responses`: an OpenAI-Responses-compatible endpoint for the desktop gateway's `managed` route,
 * authenticated by an allowance credential (credentials.ts) and metered through the same ledger as
 * `/v1/allowance/complete` (ledger.ts). It accepts exactly the body that route sends:
 *   { model, instructions, input, tools: [], tool_choice: 'none', store: false, max_output_tokens,
 *     text: { format: { type: 'json_schema', name, strict, schema } } }
 * and answers a Responses-shaped reply whatever the provider:
 *   { id, object: 'response', status, model, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
 *     output_text, usage: { input_tokens, output_tokens } }
 * An `openai` model gets a Responses request with the json_schema format; an `anthropic` model gets a Messages request
 * with the instructions as `system` and the input as the one user message. Nothing of either is stored.
 */
import type { HostedDeps } from '../shared/module.ts';
import type { HeaderMap, HostedRequest, HostedResponse } from '../shared/http.ts';
import { fields, json } from '../shared/http.ts';
import { check } from '../shared/errors.ts';
import { newId } from '../shared/crypto.ts';
import { MODEL_NAME, type PricingTable } from './pricing.ts';
import type { ChatMessage, JsonSchemaFormat, ModelProvider } from './providers.ts';
import { metered } from './ledger.ts';
import { FRAMING_TOKENS_PER_MESSAGE, FRAMING_TOKENS_PER_REQUEST, MAX_OUTPUT_TOKENS } from './module.ts';
import type { CredentialPrincipal } from './credentials.ts';

/** The gateway caps its payload at 256 KiB; instructions and input together stay under this many characters. */
export const MAX_RESPONSES_CHARS = 250_000;
export const MAX_SCHEMA_BYTES = 64 * 1024;
export const RESPONSES_MAX_BODY = 320 * 1024;

export type ResponsesRequest = { model: string; instructions?: string; input: string; maxOutputTokens: number; format?: JsonSchemaFormat };

const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function parseResponsesRequest(value: unknown): ResponsesRequest {
  const body = fields<any>(value, ['model', 'input', 'max_output_tokens'], ['instructions', 'tools', 'tool_choice', 'store', 'text']);
  check(typeof body.model === 'string' && MODEL_NAME.test(body.model), 'INVALID_REQUEST', 'The model name is not valid.');
  check(typeof body.input === 'string' && body.input.length > 0, 'INVALID_REQUEST', 'The input must be text.');
  check(body.instructions === undefined || typeof body.instructions === 'string', 'INVALID_REQUEST', 'The instructions must be text.');
  check((body.instructions ?? '').length + body.input.length <= MAX_RESPONSES_CHARS, 'INVALID_REQUEST', 'The input is too long.');
  check(Number.isInteger(body.max_output_tokens) && body.max_output_tokens >= 1 && body.max_output_tokens <= MAX_OUTPUT_TOKENS, 'INVALID_REQUEST', 'The output limit is not valid.');
  check(body.tools === undefined || (Array.isArray(body.tools) && body.tools.length === 0), 'TOOLS_NOT_ALLOWED', 'This endpoint runs no tools.');
  check(body.tool_choice === undefined || body.tool_choice === 'none', 'TOOLS_NOT_ALLOWED', 'This endpoint runs no tools.');
  check(body.store === undefined || body.store === false, 'INVALID_REQUEST', 'Nothing is stored here: send store false or leave it out.');
  let format: JsonSchemaFormat | undefined;
  if (body.text !== undefined) {
    const text = fields<any>(body.text, ['format']);
    const f = fields<any>(text.format, ['type', 'name', 'schema'], ['strict', 'description']);
    check(f.type === 'json_schema' && typeof f.name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(f.name) && plainObject(f.schema)
      && (f.strict === undefined || typeof f.strict === 'boolean') && (f.description === undefined || (typeof f.description === 'string' && f.description.length <= 1000)),
    'INVALID_REQUEST', 'The output format must be a json_schema format.');
    check(Buffer.byteLength(JSON.stringify(f.schema), 'utf8') <= MAX_SCHEMA_BYTES, 'INVALID_REQUEST', 'The output schema is too large.');
    format = { type: 'json_schema', name: f.name, schema: f.schema, ...(f.strict !== undefined ? { strict: f.strict } : {}), ...(f.description !== undefined ? { description: f.description } : {}) };
  }
  return { model: body.model, ...(body.instructions !== undefined ? { instructions: body.instructions } : {}), input: body.input, maxOutputTokens: body.max_output_tokens, ...(format ? { format } : {}) };
}

/** A server-made request id, or `idk_` + a caller's `Idempotency-Key` so a resend is refused (`REQUEST_EXISTS`). */
export function responsesRequestId(headers: HeaderMap): string {
  const key = headers['idempotency-key'];
  if (key === undefined) return newId('rsp');
  check(/^[A-Za-z0-9_-]{8,124}$/.test(key), 'INVALID_REQUEST', 'The idempotency key is not valid.');
  return `idk_${key}`;
}

/** Instructions, input and schema by UTF-8 bytes (no tokenizer emits more tokens than bytes), plus framing. */
export function responsesInputBound(input: ResponsesRequest): number {
  return Buffer.byteLength(input.instructions ?? '', 'utf8') + Buffer.byteLength(input.input, 'utf8') + 2 * FRAMING_TOKENS_PER_MESSAGE + FRAMING_TOKENS_PER_REQUEST
    + (input.format ? Buffer.byteLength(JSON.stringify(input.format), 'utf8') : 0);
}

export function responsesHandler(deps: HostedDeps, options: { providers: { anthropic?: ModelProvider; openai?: ModelProvider }; pricing: PricingTable | null; authenticate: (request: HostedRequest) => Promise<CredentialPrincipal> }) {
  const { providers, pricing } = options;
  return async function responses(request: HostedRequest): Promise<HostedResponse> {
    const { accountId } = await options.authenticate(request);
    const plan = await deps.entitlements(accountId);
    check(plan.allowance, 'PLAN_REQUIRED', 'The model allowance needs the paid plan.', 402);
    check(pricing, 'PRICING_NOT_SET', 'Model prices are not set on this server yet.', 503);
    const requestId = responsesRequestId(request.headers);
    const input = parseResponsesRequest(json(request));
    const priced = pricing.models.filter(m => m.model === input.model);
    check(priced.length > 0, 'MODEL_NOT_PRICED', 'This model has no price on this server.', 400);
    const price = priced.find(m => providers[m.route]) ?? priced[0], provider = providers[price.route];
    check(provider, 'PROVIDER_NOT_CONFIGURED', 'This model route is not set up on this server.', 503);
    const messages: ChatMessage[] = [{ role: 'user', content: input.input }];
    const { result, cost, balance } = await metered(deps, { accountId, requestId, route: price.route, model: price.model, price, pricing,
      grant: BigInt(plan.allowanceMonthlyPaise), inputTokenBound: responsesInputBound(input), maxOutputTokens: input.maxOutputTokens },
    signal => provider.complete({ model: price.model, ...(input.instructions !== undefined ? { system: input.instructions } : {}), messages,
      maxOutputTokens: input.maxOutputTokens, ...(input.format ? { format: input.format } : {}), signal }));
    return { status: 200, headers: { 'x-request-id': requestId, 'x-chausar-cost-paise': cost.toString(), 'x-chausar-balance-paise': balance.toString() }, body: {
      id: requestId, object: 'response', status: result.incomplete ? 'incomplete' : 'completed', ...(result.incomplete ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
      model: price.model, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: result.text }] }], output_text: result.text,
      usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
    } };
  };
}
