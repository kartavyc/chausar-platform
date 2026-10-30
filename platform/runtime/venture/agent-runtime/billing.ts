import { check, type Context, type State } from '../../contracts.ts';
import type { ModelConnectionRecord, SpendRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { digest, formatMicros, listRecords, readVenture, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { countedMicros, reserveSpend, settleSpend, spendAgentOf, spendRefused, type SpendSubject } from '../money/spend.ts';
import { sumReceiptIn } from '../money/sums.ts';
import { modelBudgetUsed } from '../models/budget.ts';
import { exactModelRate } from '../models/exact-rate.ts';
import { agentCostPlan, priceAgentUsage } from './cost-proof.ts';
import type { AgentRoute } from './route-types.ts';
import type { AgentTurnResult, AgentUsage } from './driver-types.ts';
export type AgentBilling = { dispatched(): Promise<void>; usage(usage: AgentUsage): Promise<void>; finish(result?: AgentTurnResult): Promise<void> };
type Input = { runId: string; jobId: string; agentId: string; route: AgentRoute };
function allowance(state: State, venture: VentureRecord, connection: ModelConnectionRecord, agentId: string, now: string, excluding?: string): bigint {
  const spends = listRecords(state, 'venture-spend', venture.id).filter(row => row.id !== excluding), month = now.slice(0, 7);
  let left = BigInt(connection.monthlyCapMicros) - modelBudgetUsed(listRecords(state, 'venture-model-call', venture.id), spends, connection.presetId, month);
  const policy = listRecords(state, 'venture-spend-policy', venture.id).at(-1);
  const used = (matches: (row: SpendRecord) => boolean) => spends.filter(matches).reduce((total, row) => total + BigInt(countedMicros(row)), 0n);
  const cap = (maximum: string | null | undefined, spent: bigint) => { if (maximum != null) { const rest = BigInt(maximum) - spent; if (rest < left) left = rest; } };
  if (policy) {
    cap(policy.capMicros, used(row => row.at.slice(0, 7) === month));
    cap(policy.dailyCapMicros, used(row => localDayAt(row.at, venture.country) === localDayAt(now, venture.country)));
    cap(policy.agentCaps?.find(row => row.agent === agentId)?.capMicros, used(row => row.at.slice(0, 7) === month && spendAgentOf(state, row) === agentId));
  }
  return left;
}
/** Reserve the owner's remaining allowance, never an invented per-turn cap. Provider reporting may lag one call. */
export async function startAgentBilling(deps: VentureDeps, ctx: Context, input: Input): Promise<AgentBilling> {
  if (!input.route.credentials) return { async dispatched() {}, async usage() {}, async finish() {} };
  const binding = input.route.billing;
  check(binding && binding.model === input.route.settings.model, 'SPEND_UNPRICED', 'This key job needs an exact model and price before starting.');
  const { venture } = readVenture(deps, ctx);
  const subject: SpendSubject = { key: `agent:${input.jobId}`, item: `model:${binding.presetId}`, label: `AI work with ${binding.model}`, payer: `connection:${binding.connectionId}`,
    draftDigest: digest({ runId: input.runId, model: binding.model, connectionId: binding.connectionId }), agent: input.agentId, connector: binding.presetId, ref: input.runId };
  let reserved: SpendRecord;
  try {
    reserved = await ventureAction(deps, ctx, 'prepare', 'agent.spend.reserve', tx => {
      const connection = tx.find('venture-model-connection', binding.connectionId);
      check(connection?.status === 'connected' && connection.presetId === binding.presetId, 'MODEL_KEY_MISSING', 'Reconnect this AI before starting.');
      const rate = exactModelRate(tx.state, venture.id, binding.presetId, binding.model, subject);
      const remaining = allowance(tx.state, venture, connection, input.agentId, tx.now);
      check(remaining > 0n, 'BUDGET_REACHED', 'Your AI spending allowance is already used or held by other work.');
      return reserveSpend(tx, { ...subject, rate, estimateMicros: String(remaining) });
    });
  } catch (error) { return spendRefused(deps, ctx, error); }
  let sent = false, finished = false, latest: AgentUsage | undefined, latestCost: string | undefined, pricingFailed = false;
  const provider = binding.presetId.startsWith('anthropic-') ? 'claude' : 'codex';
  function project(tx: VentureTx, cost: { display: string; receiptId?: string; state: 'priced' | 'unknown' }) {
    const run = tx.find('venture-delivery-run', input.runId);
    if (run?.agentJob?.scope.jobId === input.jobId) tx.replace({ ...run, agentJob: { ...run.agentJob, cost: { ...cost, spendId: reserved.id } } });
  }
  const recordUsage = async (usage: AgentUsage) => {
    if (finished) return;
    let cost: string;
    try {
      cost = priceAgentUsage(reserved.rate!, usage, provider, binding.model);
      check(!latest || usage.inputTokens >= latest.inputTokens && usage.outputTokens >= latest.outputTokens
        && (usage.cachedInputTokens ?? 0) >= (latest.cachedInputTokens ?? 0) && (usage.cacheWriteTokens ?? 0) >= (latest.cacheWriteTokens ?? 0)
        && BigInt(cost) >= BigInt(latestCost!), 'MODEL_FAILED', 'The provider usage report moved backwards. Its cost stays held.');
    } catch (error) {
      pricingFailed = true;
      await ventureAction(deps, ctx, 'prepare', 'agent.spend.unknown', tx => { project(tx, { display: 'Cost is not known. The allowance stays held.', state: 'unknown' }); tx.emit('run.step', { runId: input.runId }); });
      throw error;
    }
    latest = { ...usage }; latestCost = cost;
    const remaining = await ventureAction(deps, ctx, 'prepare', 'agent.spend.usage', tx => {
      const held = tx.find('venture-spend', reserved.id); check(held, 'MODEL_FAILED', 'This job’s spending record is missing.');
      tx.replace({ ...held, agentUsage: { provider, model: binding.model, usage: { ...usage } } });
      const receipt = sumReceiptIn(tx, agentCostPlan(tx.state, tx.venture!, { type: 'agent-cost', spendId: reserved.id }));
      project(tx, { display: `${formatMicros(cost)}${reserved.rate?.confirmed ? '' : ' (estimate, price unconfirmed)'}`, receiptId: receipt.id, state: 'priced' });
      tx.emit('run.step', { runId: input.runId });
      const connection = tx.find('venture-model-connection', binding.connectionId);
      return connection?.status === 'connected' ? allowance(tx.state, tx.venture!, connection, input.agentId, tx.now, reserved.id) : null;
    });
    check(remaining !== null, 'MODEL_KEY_MISSING', 'This AI connection was disconnected.');
    check(BigInt(cost) < remaining && BigInt(cost) < BigInt(reserved.reservedMicros), 'BUDGET_REACHED', 'The reported AI usage reached your allowance. The current provider call may already have passed it; Chausar is stopping further work.');
  };
  return {
    async dispatched() {
      await ventureAction(deps, ctx, 'prepare', 'agent.spend.dispatch', tx => {
        const connection = tx.find('venture-model-connection', binding.connectionId);
        check(connection?.status === 'connected', 'MODEL_KEY_MISSING', 'This AI connection was disconnected.');
        check(allowance(tx.state, tx.venture!, connection, input.agentId, tx.now, reserved.id) > 0n, 'BUDGET_REACHED', 'Your AI spending allowance is already used or held by other work.');
      });
      sent = true;
    }, usage: recordUsage,
    async finish(result) {
      if (finished) return;
      if (result?.usage) { try { await recordUsage(result.usage); } catch { /* Keep the reported proof but retain the allowance when final pricing is uncertain. */ } }
      finished = true;
      await ventureAction(deps, ctx, 'prepare', 'agent.spend.finish', tx => {
        if (!sent) settleSpend(tx, subject.key, { kind: 'released' });
        else if (result?.status === 'completed' && result.usage && latest && latestCost !== undefined && !pricingFailed) settleSpend(tx, subject.key, { kind: 'billed', micros: latestCost, by: 'usage' });
        else { settleSpend(tx, subject.key, { kind: 'unknown' }); project(tx, { display: 'Final cost is not known. The allowance stays held.', state: 'unknown' }); }
        tx.emit('run.step', { runId: input.runId });
      });
    },
  };
}
