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
 */
import type { HostedDeps, HostedModule } from '../shared/module.ts';
import type { HostedRequest, Router } from '../shared/http.ts';
import type { Sql } from '../db/sql.ts';
import { headersOnly, json, fields, ok } from '../shared/http.ts';
import { HostedError, check } from '../shared/errors.ts';
import { monthKey } from '../shared/clock.ts';
import { costPaise, MODEL_NAME, ROUTES, type ModelRoute, type PricingTable } from './pricing.ts';
import { ProviderFailed, type ChatMessage, type ModelProvider } from './providers.ts';
import { allowanceGrant } from '../shared/auth.ts';

export const MAX_MESSAGES = 50;
export const MAX_CONTENT_CHARS = 100_000;
export const MAX_OUTPUT_TOKENS = 8192;
/** Framing tokens a provider adds around the text: per message and per request. Generous on purpose. */
export const FRAMING_TOKENS_PER_MESSAGE = 16;
export const FRAMING_TOKENS_PER_REQUEST = 64;
export const PROVIDER_TIMEOUT_MS = 120_000;

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

async function totals(sql: Sql, accountId: string, month: string): Promise<{ spent: bigint; reserved: bigint }> {
  const { rows: [row] } = await sql.query<{ spent: string; reserved: string }>(
    `SELECT COALESCE(SUM(cost_paise) FILTER (WHERE state = 'settled'), 0)::text AS spent,
            COALESCE(SUM(reserved_paise) FILTER (WHERE state IN ('reserved', 'unknown')), 0)::text AS reserved
     FROM allowance_requests WHERE account_id = $1 AND month = $2`, [accountId, month]);
  return { spent: BigInt(row.spent), reserved: BigInt(row.reserved) };
}

export function createAllowanceModule(deps: HostedDeps, options: { providers: { anthropic?: ModelProvider; openai?: ModelProvider }; pricing: PricingTable | null }): HostedModule {
  const { sql, clock } = deps, { providers, pricing } = options;

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
    const worst = costPaise(price, pricing.fxPaisePerUsd, inputTokenBound(input.system, input.messages), input.maxOutputTokens);
    const grant = BigInt(plan.allowanceMonthlyPaise), now = clock(), month = monthKey(now);
    await sql.transaction(async tx => {
      // The month row is the lock every reservation for this account and month waits on.
      await tx.query(`INSERT INTO allowance_months (account_id, month, grant_paise, updated_at) VALUES ($1, $2, $3, $4)
                      ON CONFLICT (account_id, month) DO UPDATE SET grant_paise = EXCLUDED.grant_paise, updated_at = EXCLUDED.updated_at`, [accountId, month, grant.toString(), now.toISOString()]);
      const { rows: [seen] } = await tx.query('SELECT 1 FROM allowance_requests WHERE account_id = $1 AND request_id = $2', [accountId, input.requestId]);
      check(!seen, 'REQUEST_EXISTS', 'This request was already made once.', 409);
      const { spent, reserved } = await totals(tx, accountId, month);
      check(grant - spent - reserved - worst >= 0n, 'ALLOWANCE_EXHAUSTED', 'The model allowance for this month is used up.', 402);
      await tx.query(`INSERT INTO allowance_requests (account_id, request_id, month, route, model, state, reserved_paise, pricing_checked_on, created_at)
                      VALUES ($1, $2, $3, $4, $5, 'reserved', $6, $7, $8)`, [accountId, input.requestId, month, input.route, input.model, worst.toString(), pricing.checkedOn, now.toISOString()]);
    });
    const close = (state: 'failed' | 'unknown') => sql.query(`UPDATE allowance_requests SET state = $3, settled_at = $4 WHERE account_id = $1 AND request_id = $2 AND state = 'reserved'`,
      [accountId, input.requestId, state, clock().toISOString()]);
    let result: { text: string; inputTokens: number; outputTokens: number };
    try {
      result = await provider.complete({ model: input.model, ...(input.system !== undefined ? { system: input.system } : {}), messages: input.messages, maxOutputTokens: input.maxOutputTokens, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
      if (typeof result?.text !== 'string' || !Number.isSafeInteger(result.inputTokens) || !Number.isSafeInteger(result.outputTokens) || result.inputTokens < 0 || result.outputTokens < 0) throw new Error('PROVIDER_REPLY_INVALID');
    } catch (error) {
      if (error instanceof ProviderFailed) { await close('failed'); throw new HostedError('PROVIDER_FAILED', 'The model provider refused the request. Nothing was charged.', 502); }
      await close('unknown');
      throw new HostedError('PROVIDER_OUTCOME_UNKNOWN', 'The model provider did not answer clearly. The reserved amount stays held until it is checked.', 504);
    }
    const cost = costPaise(price, pricing.fxPaisePerUsd, result.inputTokens, result.outputTokens);
    // The measured cost is recorded as it is, even in the unexpected case that it exceeds the reservation.
    await sql.query(`UPDATE allowance_requests SET state = 'settled', cost_paise = $3, input_tokens = $4, output_tokens = $5, settled_at = $6
                     WHERE account_id = $1 AND request_id = $2 AND state = 'reserved'`,
      [accountId, input.requestId, cost.toString(), result.inputTokens, result.outputTokens, clock().toISOString()]);
    const after = await totals(sql, accountId, month);
    return ok({
      requestId: input.requestId, text: result.text, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      costPaise: cost.toString(), balancePaise: (grant - after.spent - after.reserved).toString(), route: input.route, model: input.model, pricingCheckedOn: pricing.checkedOn,
    });
  }

  return {
    id: 'allowance',
    routes(router: Router) { router.add('GET', '/v1/allowance', summary).add('POST', '/v1/allowance/complete', complete, { authenticateFirst: headersOnly(deps.authenticate) }); },
  };
}
