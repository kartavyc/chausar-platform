/**
 * The allowance ledger every metered route goes through (`/v1/allowance/complete` and `/v1/allowance/responses`).
 * See module.ts for the rules: worst case reserved under the month lock, measured cost settled, a clear refusal
 * released, an unclear outcome kept. Nothing here sees or stores the prompt or the answer.
 */
import type { HostedDeps } from '../shared/module.ts';
import type { Sql } from '../db/sql.ts';
import { HostedError, check } from '../shared/errors.ts';
import { monthKey } from '../shared/clock.ts';
import { costPaise, type ModelRoute, type PricedModel, type PricingTable } from './pricing.ts';
import { ProviderFailed, type Completion } from './providers.ts';

export const PROVIDER_TIMEOUT_MS = 120_000;

export async function totals(sql: Sql, accountId: string, month: string): Promise<{ spent: bigint; reserved: bigint }> {
  const { rows: [row] } = await sql.query<{ spent: string; reserved: string }>(
    `SELECT COALESCE(SUM(cost_paise) FILTER (WHERE state = 'settled'), 0)::text AS spent,
            COALESCE(SUM(reserved_paise) FILTER (WHERE state IN ('reserved', 'unknown')), 0)::text AS reserved
     FROM allowance_requests WHERE account_id = $1 AND month = $2`, [accountId, month]);
  return { spent: BigInt(row.spent), reserved: BigInt(row.reserved) };
}

export type MeteredCall = {
  accountId: string; requestId: string; route: ModelRoute; model: string; price: PricedModel; pricing: PricingTable;
  /** The account's monthly grant in whole paise. */
  grant: bigint;
  /** Upper bounds the provider can bill for. */
  inputTokenBound: number; maxOutputTokens: number;
};
export type Metered = { result: Completion; cost: bigint; balance: bigint };

/** Reserves, calls the provider once, then settles, releases or keeps the reservation by the outcome. */
export async function metered(deps: Pick<HostedDeps, 'sql' | 'clock'>, call: MeteredCall, provider: (signal: AbortSignal) => Promise<Completion>): Promise<Metered> {
  const { sql, clock } = deps, { accountId, requestId, price, pricing, grant } = call;
  const worst = costPaise(price, pricing.fxPaisePerUsd, call.inputTokenBound, call.maxOutputTokens);
  const now = clock(), month = monthKey(now);
  await sql.transaction(async tx => {
    // The month row is the lock every reservation for this account and month waits on.
    await tx.query(`INSERT INTO allowance_months (account_id, month, grant_paise, updated_at) VALUES ($1, $2, $3, $4)
                    ON CONFLICT (account_id, month) DO UPDATE SET grant_paise = EXCLUDED.grant_paise, updated_at = EXCLUDED.updated_at`, [accountId, month, grant.toString(), now.toISOString()]);
    const { rows: [seen] } = await tx.query('SELECT 1 FROM allowance_requests WHERE account_id = $1 AND request_id = $2', [accountId, requestId]);
    check(!seen, 'REQUEST_EXISTS', 'This request was already made once.', 409);
    const { spent, reserved } = await totals(tx, accountId, month);
    check(grant - spent - reserved - worst >= 0n, 'ALLOWANCE_EXHAUSTED', 'The model allowance for this month is used up.', 402);
    await tx.query(`INSERT INTO allowance_requests (account_id, request_id, month, route, model, state, reserved_paise, pricing_checked_on, created_at)
                    VALUES ($1, $2, $3, $4, $5, 'reserved', $6, $7, $8)`, [accountId, requestId, month, call.route, call.model, worst.toString(), pricing.checkedOn, now.toISOString()]);
  });
  const close = (state: 'failed' | 'unknown') => sql.query(`UPDATE allowance_requests SET state = $3, settled_at = $4 WHERE account_id = $1 AND request_id = $2 AND state = 'reserved'`,
    [accountId, requestId, state, clock().toISOString()]);
  let result: Completion;
  try {
    result = await provider(AbortSignal.timeout(PROVIDER_TIMEOUT_MS));
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
    [accountId, requestId, cost.toString(), result.inputTokens, result.outputTokens, clock().toISOString()]);
  const after = await totals(sql, accountId, month);
  return { result, cost, balance: grant - after.spent - after.reserved };
}
