// Shared fixtures for the Ink v2 wave 4 team tests (4A1: departments, Keeper, agent health, department spend): a
// flagship playbook in use, harness turns and tool calls as the agent loop stores them, and spend records as the
// spend ledger keeps them. Built on venture-views-env.ts; nothing here sends anything.
import type { AgentTurnRecord, PlaybookRecord, SimulationRunRecord, SpendPolicyRecord, SpendRecord, ToolCallRecord, ToolEffect } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { flagshipDelivery, type FlagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { owner, seedBlueprint, seedOrder, type Env } from './venture-views-env.ts';

export type FlagshipId = 'youtube' | 'ca-firm' | 'social-agency';

/** A business whose playbook in use is a flagship's own steps, with an accepted plan and one open order. */
export async function flagshipTeam(env: Env, flagship: FlagshipId) {
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const delivery: FlagshipDelivery = flagshipDelivery(flagship)!;
  const playbook = await ventureAction(env.deps, owner, 'admin', 'seed.flagship', tx => {
    const record = tx.put<PlaybookRecord>({
      ...tx.base('venture-playbook'), version: 1, hash: `${flagship}-hash`, blueprintDigest: plan.digest, serviceType: 'studio',
      steps: structuredClone([...delivery.steps]), validated: true, tierCeiling: 'actor', format: 2, flagship,
    });
    tx.touch({ playbookId: record.id });
    return record;
  });
  const { order, client } = await seedOrder(env, plan);
  return { plan, playbook, order, client, delivery };
}

/** One harness turn: an act turn with these tool calls, or the write turn. */
export function turn(number: number, tools: string[], callId: string | null, step: 'act' | 'write' = 'act'): AgentTurnRecord {
  return {
    turn: number, step, note: step === 'write' ? 'Wrote the reply.' : 'Worked.', calls: tools.map(tool => ({ tool, input: '{}' })),
    finished: step === 'write', forced: false, by: 'model', callId, costMicros: '0',
  };
}

/** One stored tool call of a turn. */
export function toolCall(id: string, turnNumber: number, tool: string, effect: ToolEffect = 'read', at?: string): ToolCallRecord {
  return {
    id, turn: turnNumber, tool, input: {}, inputDigest: 'input-digest', envelope: { ok: true, result: {} }, outcome: 'succeeded', effect, tier: 'code',
    receiptIds: [], tableIds: [], ...(at ? { startedAt: at, finishedAt: at } : {}),
  };
}

/**
 * A spend record as the ledger keeps it. settled: billed at the figure; reserved: held while the call runs; unknown:
 * the answer never came. at: when it was reserved (defaults to now).
 */
export async function seedSpend(env: Env, input: { ref: string; micros: string; phase?: 'settled' | 'reserved' | 'unknown'; at?: string; label?: string; agent?: string | null }): Promise<SpendRecord> {
  const phase = input.phase ?? 'settled';
  return ventureAction(env.deps, owner, 'prepare', 'seed.spend', tx => tx.put<SpendRecord>({
    ...tx.base('venture-spend'), ...(input.at ? { at: input.at } : {}),
    key: `model:${input.ref}`, item: 'model:anthropic-sonnet-5-5', label: input.label ?? `Claude Sonnet, ${input.ref}`, agent: input.agent ?? null, connector: 'anthropic-sonnet-5-5',
    payer: 'connection:conn_1', draftDigest: 'draft-digest', rate: null, reservedMicros: input.micros,
    settledMicros: phase === 'settled' ? input.micros : null, settledBy: phase === 'settled' ? 'bill' : null, phase, quoteId: null, ref: input.ref, refusal: null,
    settledAt: phase === 'settled' ? tx.now : null,
  }));
}

/** The owner's rupee rate (83.50 per dollar, set on 15 Oct 2026) on a spend policy with no limits. */
export async function seedRupeeRate(env: Env): Promise<SpendPolicyRecord> {
  return ventureAction(env.deps, owner, 'approve', 'seed.policy', tx => tx.put<SpendPolicyRecord>({
    ...tx.base('venture-spend-policy'), capMicros: null, askAboveMicros: null, rates: [], rupeeRate: { perUsd: '835000', setOn: '2026-10-15' },
  }));
}

/** A finished rehearsal with practice clients. */
export async function seedRehearsal(env: Env, playbookId: string): Promise<SimulationRunRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.rehearsal', tx => tx.put<SimulationRunRecord>({
    ...tx.base('venture-simulation-run'), playbookId, playbookHash: 'hash', scenarioIds: [], episodes: [], passed: true,
    summary: { scenarios: 0, passed: 0, failed: 0 }, costMicros: '0', costDisplay: 'USD 0.0000', startedAt: tx.now, finishedAt: tx.now, modelMode: 'template',
  }));
}
