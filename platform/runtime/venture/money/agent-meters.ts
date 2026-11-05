// W6 6G5 (D44): the meters per agent and per routine, and the refusal before a routine starts. Split from
// spend-meter.ts because names come from the team (chief/routing.ts), which money/spend.ts must not load at start.
import { formatRate, formatUsd } from '../../owner-format.ts';
import type { Context, State } from '../../contracts.ts';
import { listRecords } from '../records.ts';
import { microsAsUsd } from '../models/cost.ts';
import { teamAgents } from '../chief/routing.ts';
import { chatAgent } from '../agents/roles.ts';
import { AGENT_ID, agentName } from '../views/shared.ts';
import { rupeesBeside, rupeesOf, spendAgentOf, spendLead } from './spend.ts';
import {
  METER_WORDS, MICROS, agentMonthTotal, callAgent, counted, latestPolicy, planCall, planJob, pretty, routineMonthTotal, routineName, spentByPlan,
} from './spend-meter.ts';
import type { Display, MicroString, RoutineRecord, SpendMeterRowView, SpendMetersView, SpendPolicyRecord, VentureDeps, VentureRecord } from '../contracts.ts';

const monthOf = (iso: string) => iso.slice(0, 7);

/**
 * An agent's name as receipts and meters say it: its name on the team, the delivery agent's, or its own name with
 * '(retired)' once it is off the team (6G2 keeps a retired agent's role, so its name still reads; an id no role names
 * any more reads as words).
 */
export function receiptAgentName(state: State, venture: VentureRecord, agent: string): Display {
  const found = teamAgents(state, venture).find(item => item.id === agent);
  if (found) return found.name;
  if (agent === AGENT_ID) return agentName(state, venture);
  let name: string;
  try { name = chatAgent(state, venture, agent).name; } catch { name = pretty(agent); }
  return METER_WORDS.retired(name);
}

/**
 * Before a routine run starts on a key (W6 6G5): why it may not, or null. Its own limit used, its agent's own limit used,
 * or the month's limit used: each is a run that would pass the owner's cap, so it is refused with the reason before
 * anything is sent. A routine on the owner's plan spends nothing Chausar counts, so none of these hold it.
 */
export function routineStartRefusal(state: State, venture: VentureRecord, routine: RoutineRecord, nowIso: string): string | null {
  const policy = latestPolicy(state, venture.id);
  if (!policy) return null;
  const records = listRecords(state, 'venture-spend', venture.id);
  const month = monthOf(nowIso);
  const own = (policy.routineCaps ?? []).find(item => item.routine === routine.id);
  if (own && routineMonthTotal(records, routine.id, month) >= BigInt(own.capMicros)) return METER_WORDS.ownLimit(routine.name, formatRate(own.capMicros));
  const agentCap = routine.agent ? (policy.agentCaps ?? []).find(item => item.agent === routine.agent) : undefined;
  if (routine.agent && agentCap && agentMonthTotal(state, records, routine.agent, month) >= BigInt(agentCap.capMicros)) {
    return METER_WORDS.ownLimit(receiptAgentName(state, venture, routine.agent), formatRate(agentCap.capMicros));
  }
  if (policy.capMicros !== null) {
    const spent = records.reduce((total, record) => (monthOf(record.at) === month ? total + counted(record) : total), 0n);
    if (spent >= BigInt(policy.capMicros)) return METER_WORDS.monthUsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The meters
// ---------------------------------------------------------------------------

/** A share in thousandths as a whole percentage, rounded down: 505 is '50%'. */
const percentOf = (permille: bigint): string => `${permille / 10n}%`;

type Counts = { plan: Map<string, number>; media: Map<string, { micros: bigint; upTo: boolean }> };

/** This month's plan runs by agent and by routine, and Sunra quotes by agent. */
function counts(state: State, venture: VentureRecord, month: string): { agents: Counts; routines: Map<string, number> } {
  const agents: Counts = { plan: new Map(), media: new Map() };
  const routines = new Map<string, number>();
  const bump = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);
  for (const call of listRecords(state, 'venture-model-call', venture.id)) {
    if (monthOf(call.at) !== month || !planCall(call) || (call.status !== 'completed' && call.status !== 'dispatching')) continue;
    const agent = callAgent(call);
    if (agent) bump(agents.plan, agent);
    if (call.routineId) bump(routines, call.routineId);
  }
  const runs = new Map(listRecords(state, 'venture-delivery-run', venture.id).map(run => [run.id, run]));
  for (const run of runs.values()) if (monthOf(run.at) === month && planJob(state, run)) bump(agents.plan, run.agentJob!.scope.agentId);
  for (const generation of listRecords(state, 'venture-media-generation', venture.id)) {
    if (monthOf(generation.at) !== month || (generation.status !== 'approved' && generation.status !== 'submitted')) continue;
    if (!MICROS.test(generation.quote.usdMicros)) continue;
    const agent = runs.get(generation.runId)?.agentJob?.scope.agentId ?? AGENT_ID;
    const held = agents.media.get(agent) ?? { micros: 0n, upTo: false };
    agents.media.set(agent, { micros: held.micros + BigInt(generation.quote.usdMicros), upTo: held.upTo || generation.quote.basis === 'up-to' });
  }
  return { agents, routines };
}

/** The meters of the open business this month, each row with its sum receipt (written once per distinct sum). */
export async function spendMeters(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, policy: SpendPolicyRecord | null): Promise<SpendMetersView> {
  const nowIso = deps.clock().toISOString();
  const month = monthOf(nowIso);
  const records = listRecords(state, 'venture-spend', venture.id);
  const monthRecords = records.filter(record => monthOf(record.at) === month);
  const rupees = rupeesOf(state, venture);
  const { sumReceipt } = await import('./sums.ts');
  const { agents: agentCounts, routines: routineCounts } = counts(state, venture, month);

  const row = async (scope: 'agent' | 'routine', id: string, name: Display, used: bigint, cap: MicroString | undefined, plan: number, media?: { micros: bigint; upTo: boolean }): Promise<SpendMeterRowView> => {
    const receipt = await sumReceipt(deps, ctx, venture.id, spentByPlan(state, venture, { type: 'spent-by', scope, id, month }));
    const capped = cap !== undefined ? BigInt(cap) : null;
    const permille = capped === null ? null : capped > 0n ? (used * 1000n) / capped : 1000n;
    const paused = capped !== null && used >= capped;
    return {
      scope, id, name,
      used: formatUsd(String(used)) + METER_WORDS.thisMonth, usedLead: spendLead(String(used), rupees, METER_WORDS.thisMonth), receiptId: receipt.id,
      plan: plan > 0 ? METER_WORDS.plan(plan) : null,
      ...(media && media.micros > 0n ? { media: METER_WORDS.media(media.upTo, formatUsd(String(media.micros))) } : {}),
      cap: cap === undefined ? null : formatRate(cap) + METER_WORDS.perMonth, capUsd: cap === undefined ? null : microsAsUsd(cap),
      ...(rupees && cap !== undefined ? { capRupees: rupeesBeside(cap, rupees)! } : {}),
      usedPermille: permille === null ? null : parseInt((permille > 1000n ? 1000n : permille).toString(), 10), paused,
      line: capped === null ? METER_WORDS.noLimit : paused ? METER_WORDS.paused : METER_WORDS.used(percentOf(permille!)),
    };
  };

  const agentCaps = new Map((policy?.agentCaps ?? []).map(item => [item.agent, item.capMicros]));
  const agentIds = new Set<string>(teamAgents(state, venture).map(agent => agent.id));
  for (const record of monthRecords) { const agent = spendAgentOf(state, record); if (agent && counted(record) > 0n) agentIds.add(agent); }
  for (const id of [...agentCaps.keys(), ...agentCounts.plan.keys(), ...agentCounts.media.keys()]) agentIds.add(id);
  const agents: SpendMeterRowView[] = [];
  for (const id of agentIds) {
    agents.push(await row('agent', id, receiptAgentName(state, venture, id), agentMonthTotal(state, records, id, month), agentCaps.get(id), agentCounts.plan.get(id) ?? 0, agentCounts.media.get(id)));
  }

  const routineCaps = new Map((policy?.routineCaps ?? []).map(item => [item.routine, item.capMicros]));
  const allRoutines = new Map(listRecords(state, 'venture-routine', venture.id).map(routine => [routine.id, routine]));
  const routineIds = new Set<string>([...allRoutines.values()].filter(routine => routine.removedAt === null).map(routine => routine.id));
  for (const record of monthRecords) if (record.routine && counted(record) > 0n) routineIds.add(record.routine);
  for (const id of [...routineCaps.keys(), ...routineCounts.keys()]) routineIds.add(id);
  const routines: SpendMeterRowView[] = [];
  for (const id of routineIds) {
    routines.push(await row('routine', id, routineName(allRoutines.get(id), id), routineMonthTotal(records, id, month), routineCaps.get(id), routineCounts.get(id) ?? 0));
  }
  return { month, agents, routines };
}
