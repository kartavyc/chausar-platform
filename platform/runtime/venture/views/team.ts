// Chausar venture launcher, views (P1-A): the team. venture.team.list and venture.team.gate.
// This build has one agent per business, the delivery agent its playbook describes; its steps are the playbook's.
// Each step has a gate: 'hold' asks the owner, 'auto' lets the step run. Gates start on hold. Steps in the always-ask
// floor (money out, sending to a client or the public, deleting, changing prices, anything on a government portal)
// stay on hold at every posture, so a request to set one to auto is refused with GATE_FLOOR. This view stores the
// gate; the policy package (P2-posture) enforces it in the harness. Until then every agent turn still waits for the
// owner's approval of its exact text, which is stricter than any gate shown here.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { currentVenture, exactPayload, formatMicros, identifier, listRecords, requireAppChannel, sumMicros, ventureAction } from '../records.ts';
import type { AgentView, LaunchStage, PlaybookStep, Posture, TeamGateRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentPlaybook, playbookSteps } from '../delivery/playbook.ts';
import { toolSpec } from '../delivery/harness/tools.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { ESTIMATE_WORDS } from '../models/cost.ts';
import { deliveryRunDetails } from './runs.ts';
import { AGENT_ID, agentName, clientNameFor, plain } from './shared.ts';

const ROLE = 'Reads each order, works on it with tools, and drafts the reply for you to check.';
/** The model purposes this agent spends on. Rehearsal clients, judges and plan writing are not its spend. */
const AGENT_PURPOSES: readonly string[] = ['delivery', 'agent-turn'];
const POSTURE: Readonly<Record<LaunchStage, Posture>> = {
  rehearsal: 'rehearsal', shadow: 'shadow', 'approve-each': 'approve-each',
  // Approving a sample is planned; until it exists the closest honest posture is approving each one.
  'approve-sample': 'approve-each', 'auto-spot-check': 'auto-spot-check',
};
export const FLOOR_WORDS = Object.freeze({
  send: 'Sending to a client or the public always asks you first.',
  outside: 'Acting outside Chausar always asks you first.',
});

/** Why a step is in the always-ask floor, or null. Code decides from the step's kind and its tools' effects. */
export function floorReason(step: PlaybookStep): string | null {
  if (step.kind === 'operator') return FLOOR_WORDS.send;
  if ((step.tools ?? []).some(tool => toolSpec(tool)?.effect === 'outside-write')) return FLOOR_WORDS.outside;
  return null;
}

/** The agent's steps: the playbook in use, else the accepted plan's fixed steps (worked out, never stored, here). */
function agentSteps(state: State, venture: VentureRecord): PlaybookStep[] | null {
  const playbook = currentPlaybook(state, venture);
  if (playbook) return playbook.steps;
  const plan = acceptedBlueprintOrNull(state, venture);
  if (!plan) return null;
  try { return playbookSteps(plan); } catch { return null; }
}

function spendOf(state: State, venture: VentureRecord): string {
  const calls = state.conversations.filter((record: any) => record?.kind === 'venture-model-call' && record.ventureId === venture.id
    && AGENT_PURPOSES.includes(record.purpose) && typeof record.costMicros === 'string' && /^\d{1,30}$/.test(record.costMicros)) as { costMicros: string; priceConfirmed?: unknown }[];
  const total = formatMicros(sumMicros(calls.map(call => call.costMicros)));
  return calls.some(call => call.priceConfirmed === false) ? `${total}${ESTIMATE_WORDS}` : total;
}

function agentView(deps: VentureDeps, state: State, venture: VentureRecord): AgentView | null {
  const steps = agentSteps(state, venture);
  if (!steps) return null;
  const posture = POSTURE[venture.launchStage] ?? 'rehearsal';
  const gates = new Map<string, 'auto' | 'hold'>();
  for (const record of listRecords(state, 'venture-team-gate', venture.id)) if (record.agentId === AGENT_ID) gates.set(record.stepId, record.gate);
  const runs = deliveryRunDetails(deps, state, venture);
  const busy = runs.find(run => run.state === 'waiting' || run.state === 'active');
  const step = busy?.steps.find(item => item.state === 'waiting' || item.state === 'current');
  const now = !busy ? 'Idle' : busy.state === 'active' ? `Working: ${step?.purpose ?? busy.purpose}` : `Waiting on you: ${step?.purpose ?? busy.purpose}`;
  const reviewed = listRecords(state, 'venture-delivery-run', venture.id).filter(run => run.verdict !== null)
    .sort((a, b) => (b.verdict!.at).localeCompare(a.verdict!.at))[0];
  const verdictWords = { accepted: 'accepted', edited: 'edited by you', rejected: 'rejected' } as const;
  const receiptId = reviewed?.harness?.workReceiptIds.at(-1);
  return plain({
    id: AGENT_ID, name: agentName(state, venture), role: ROLE, now, posture, spend: spendOf(state, venture),
    ...(reviewed ? { last: { line: `Draft for ${clientNameFor(state, venture.id, reviewed.orderId)} ${verdictWords[reviewed.verdict!.choice]}.`, ...(receiptId ? { receiptId } : {}) } } : {}),
    steps: steps.map(item => {
      const floor = floorReason(item) !== null;
      const stored = gates.get(item.id);
      const gate: 'auto' | 'hold' = floor ? 'hold' : stored ?? (posture === 'auto-spot-check' ? 'auto' : 'hold');
      return { id: item.id, purpose: item.title, gate, floor };
    }),
  });
}

/** venture.team.list (read): the agents of this business. None until a plan is accepted. */
export async function teamListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ agents: AgentView[] }> {
  exactPayload(payload, []);
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  const agent = venture ? agentView(deps, state, venture) : null;
  return { agents: agent ? [agent] : [] };
}

/** venture.team.gate { agentId, stepId, gate } (approve, app only): stores one step's gate. A floor step never goes to auto. */
export async function teamGateHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ agent: AgentView }> {
  requireAppChannel(ctx, 'venture.team.gate');
  const body = exactPayload(payload, ['agentId', 'stepId', 'gate'], ['agentId', 'stepId', 'gate']);
  const agentId = identifier(body.agentId, 'Agent');
  const stepId = identifier(body.stepId, 'Step');
  check(body.gate === 'auto' || body.gate === 'hold', 'INVALID_VENTURE_REQUEST', 'Choose auto or hold.');
  const gate = body.gate;
  await ventureAction(deps, ctx, 'approve', 'team.gate', tx => {
    const steps = agentSteps(tx.state, tx.venture!);
    check(steps && agentId === AGENT_ID, 'AGENT_NOT_FOUND', 'That agent was not found.');
    const step = steps.find(item => item.id === stepId);
    check(step, 'STEP_NOT_FOUND', 'That step was not found.');
    const floor = floorReason(step);
    check(!(floor && gate === 'auto'), 'GATE_FLOOR', floor ?? '');
    tx.put<TeamGateRecord>({ ...tx.base('venture-team-gate'), agentId, stepId, gate });
  });
  const state = deps.store.read();
  const agent = agentView(deps, state, currentVenture(state)!);
  check(agent, 'AGENT_NOT_FOUND', 'That agent was not found.');
  return { agent };
}
