/**
 * The model allowance proxy. A paid account gets a monthly grant in whole paise (the Indian calendar month);
 * the proxy holds the provider keys and meters every request in rupees.
 *
 * Ledger: one `allowance_requests` row per (account, requestId), so a request is attempted once (`REQUEST_EXISTS`).
 * - Before the provider is called, the worst case is reserved under a row lock on the account's month:
 *   input tokens are bounded by the UTF-8 byte length of the system text and every message (no tokenizer emits
 *   more tokens than bytes) plus a fixed allowance for message framing, output by `maxOutputTokens`.
 *   Concurrent requests serialise on that lock, so together they can never reserve more than the grant.
 * - After the call the measured cost (rounded up to whole paise) is settled and the rest of the reservation released.
 * - The provider refused with an error status: nothing was produced, the reservation is released (`PROVIDER_FAILED`).
 * - No answer, a timeout or an unreadable success: the provider may have done the work and billed it, so the row
 *   becomes `unknown` and the whole reservation stays counted (`PROVIDER_OUTCOME_UNKNOWN`) until a person reconciles it.
 * The proxy stores no prompt and no answer: only counts, paise and the model name.
 * The same ledger (ledger.ts) meters `POST /v1/allowance/responses` (responses.ts), the OpenAI-Responses-shaped
 * endpoint the desktop gateway's managed route calls with an allowance-scoped credential (credentials.ts).
 */
import type { HostedDeps, HostedModule } from '../shared/module.ts';
import type { HostedRequest, Router } from '../shared/http.ts';
import { headersOnly, json, fields, ok } from '../shared/http.ts';
import { check } from '../shared/errors.ts';
import { monthKey } from '../shared/clock.ts';
import { MODEL_NAME, ROUTES, type ModelRoute, type PricingTable } from './pricing.ts';
import type { ChatMessage, ModelProvider } from './providers.ts';
import { allowanceGrant } from '../shared/auth.ts';
import { metered, totals } from './ledger.ts';
import { credentialAuthenticator, credentialHandlers, RESPONSES_PATH } from './credentials.ts';
import { responsesHandler, RESPONSES_MAX_BODY } from './responses.ts';

export const MAX_MESSAGES = 50;
export const MAX_CONTENT_CHARS = 100_000;
export const MAX_OUTPUT_TOKENS = 8192;
/** Framing tokens a provider adds around the text: per message and per request. Generous on purpose. */
export const FRAMING_TOKENS_PER_MESSAGE = 16;
export const FRAMING_TOKENS_PER_REQUEST = 64;
export { PROVIDER_TIMEOUT_MS } from './ledger.ts';

export type CompletionRequest = { requestId: string; route: ModelRoute; model: string; system?: string; messages: ChatMessage[]; maxOutputTokens: number };

export function parseCompletionRequest(value: unknown): CompletionRequest {
  const body = fields<any>(value, ['requestId', 'route', 'model', 'messages', 'maxOutputTokens'], ['system']);
  check(typeof body.requestId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(body.requestId), 'INVALID_REQUEST', 'The request id is not valid.');
  check(ROUTES.includes(body.route), 'INVALID_REQUEST', 'The route is not known.');
  check(typeof body.model === 'string' && MODEL_NAME.test(body.model), 'INVALID_REQUEST', 'The model name is not valid.');
  check(body.system === undefined || typeof body.system === 'string', 'INVALID_REQUEST', 'The system text must be text.');
  check(Array.isArray(body.messages) && body.messages.length >= 1 && body.messages.length <= MAX_MESSAGES, 'INVALID_REQUEST', 'Send between one and fifty messages.');
  let chars = (body.system ?? '').length;
  const messages: ChatMessage[] = body.messages.map((message: unknown, index: number) => {
    const m = fields<any>(message, ['role', 'content']);
    check(m.role === (index % 2 === 0 ? 'user' : 'assistant'), 'INVALID_REQUEST', 'Messages alternate between user and assistant, starting with user.');
    check(typeof m.content === 'string' && m.content.length > 0, 'INVALID_REQUEST', 'A message has no text.');
    chars += m.content.length;
    return { role: m.role, content: m.content };
  });
  check(chars <= MAX_CONTENT_CHARS, 'INVALID_REQUEST', 'The messages are too long.');
  check(Number.isInteger(body.maxOutputTokens) && body.maxOutputTokens >= 1 && body.maxOutputTokens <= MAX_OUTPUT_TOKENS, 'INVALID_REQUEST', 'The output limit is not valid.');
  return { requestId: body.requestId, route: body.route, model: body.model, ...(body.system !== undefined ? { system: body.system } : {}), messages, maxOutputTokens: body.maxOutputTokens };
}

/** The most input tokens a request can be billed for. */
export function inputTokenBound(system: string | undefined, messages: readonly ChatMessage[]): number {
  return Buffer.byteLength(system ?? '', 'utf8') + messages.reduce((sum, m) => sum + Buffer.byteLength(m.content, 'utf8') + FRAMING_TOKENS_PER_MESSAGE, 0) + FRAMING_TOKENS_PER_REQUEST;
}

export function createAllowanceModule(deps: HostedDeps, options: { providers: { anthropic?: ModelProvider; openai?: ModelProvider }; pricing: PricingTable | null; apiOrigin?: string | null }): HostedModule {
  const { sql, clock } = deps, { providers, pricing } = options;
  const credentials = credentialHandlers(deps, options.apiOrigin ?? null), byCredential = credentialAuthenticator(deps);
  const responses = responsesHandler(deps, { providers, pricing, authenticate: byCredential });

  async function summary(request: HostedRequest) {
    const { accountId } = await deps.authenticate(request);
    const plan = await deps.entitlements(accountId), month = monthKey(clock());
    // No grant set (or none in the plan) is said in words: grant and balance are null, never '0'.
    const grant = allowanceGrant(plan);
    const { spent, reserved } = await totals(sql, accountId, month);
    return ok({
      month, grantPaise: grant.paise, grantState: grant.state, spentPaise: spent.toString(), reservedPaise: reserved.toString(),
      balancePaise: grant.paise === null ? null : (BigInt(grant.paise) - spent - reserved).toString(),
      pricing: pricing ? { checkedOn: pricing.checkedOn, fxPaisePerUsd: pricing.fxPaisePerUsd, source: pricing.source } : null,
      models: pricing ? pricing.models.filter(m => providers[m.route]).map(m => ({ route: m.route, model: m.model })) : [],
    });
  }

  async function complete(request: HostedRequest) {
    const { accountId } = await deps.authenticate(request);
    const plan = await deps.entitlements(accountId);
    check(plan.allowance, 'PLAN_REQUIRED', 'The model allowance needs the paid plan.', 402);
    check(pricing, 'PRICING_NOT_SET', 'Model prices are not set on this server yet.', 503);
    const input = parseCompletionRequest(json(request));
    const price = pricing.models.find(m => m.route === input.route && m.model === input.model);
    check(price, 'MODEL_NOT_PRICED', 'This model has no price on this server.', 400);
    const provider = providers[input.route];
    check(provider, 'PROVIDER_NOT_CONFIGURED', 'This model route is not set up on this server.', 503);
    const { result, cost, balance } = await metered(deps, { accountId, requestId: input.requestId, route: input.route, model: input.model, price, pricing,
      grant: BigInt(plan.allowanceMonthlyPaise), inputTokenBound: inputTokenBound(input.system, input.messages), maxOutputTokens: input.maxOutputTokens },
    signal => provider.complete({ model: input.model, ...(input.system !== undefined ? { system: input.system } : {}), messages: input.messages, maxOutputTokens: input.maxOutputTokens, signal }));
    return ok({
      requestId: input.requestId, text: result.text, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      costPaise: cost.toString(), balancePaise: balance.toString(), route: input.route, model: input.model, pricingCheckedOn: pricing.checkedOn,
    });
  }

  return {
    id: 'allowance',
    routes(router: Router) {
      router.add('GET', '/v1/allowance', summary).add('POST', '/v1/allowance/complete', complete, { authenticateFirst: headersOnly(deps.authenticate) })
        .add('POST', '/v1/allowance/credentials', credentials.issue, { authenticateFirst: headersOnly(deps.authenticate) })
        .add('DELETE', '/v1/allowance/credentials/:credentialId', credentials.revoke)
        // Only an allowance credential opens this route; a session token is refused before the body is read.
        .add('POST', RESPONSES_PATH, responses, { authenticateFirst: headersOnly(byCredential), maxBody: RESPONSES_MAX_BODY });
    },
  };
}
