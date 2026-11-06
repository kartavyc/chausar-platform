// Chausar venture launcher, policy (Ink v2 wave 4, package 4J1; catalogue O17): "allow for this session". At auto with
// spot checks the owner lets one held step below the always-ask floor run without asking, like setting it to Auto, until
// the open vault closes. Below that posture every step waits for the owner anyway, so the method refuses with
// AUTO_LOCKED rather than promise anything. The allowance lives only in this process's memory, held by the open vault's
// store object and keyed there by business, agent and step: nothing in the vault holds it, a vault opened again (a new
// store, even after a close that failed) starts with none, and the venture host ends its own vault's allowances when the
// engine locks, closes or switches business (host.ts close); other businesses open in the same process (hosted) keep
// theirs. A policy context read without the store allows nothing. The decision to allow is recorded
// (journal/decisions.ts) with who and when; the step's stored gate never changes. A floor step (the team view's floor and
// the flagship playbook's own, policy/context.ts sessionStepFloor) is refused with ALLOW_SESSION_FLOOR and never read
// back into a policy context. Setting the step's gate again (venture.team.gate, "Stop always allowing") ends it. The
// ladder reads allowances from the policy context: they never open the floor or the taint latch, and a deny still wins.
// The once-per-session grant follows ZCode permission/service.ts (session rules beside saved ones); a rewrite, not a copy.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { currentVenture, exactPayload, identifier, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import type { AllowSessionView, IsoTime, PlaybookStep, VentureDeps, VentureRecord } from '../contracts.ts';
import { AUTO_LOCKED_WORDS } from './auto-lock.ts';

/** The one harness agent that runs every role's steps; gates are stored under it (views/team.ts). */
const HARNESS_AGENT = 'delivery';

/** One allowance: the agent and step, the decision record that granted it (its id is the rule id), when and by whom. */
type Allowance = { id: string; agentId: string; stepId: string; at: IsoTime; by: string };

/** The allowances of each open vault (its store object), by business id. Memory only; a dropped store drops them. */
let SESSION = new WeakMap<object, Map<string, Allowance[]>>();

export const ALLOW_SESSION_WORDS = Object.freeze({
  done: (title: string) => `'${title}' runs without asking until this business is locked or closed. Steps that always ask still ask.`,
  floor: (reason: string) => `${reason} It can't be allowed for a session.`,
  reason: (title: string) => `You let '${title}' run without asking until this business is locked or closed.`,
  // 4J15: auto with spot checks is built but locked, so this is refused with the lock's own words.
  locked: AUTO_LOCKED_WORDS,
});

/**
 * The steps allowed for this session in one business for one agent, step id to the decision that allowed it. An
 * allowance is void once that agent's gate on the step was set after it (Stop always allowing, or any other change).
 */
export function sessionAllowedSteps(store: object | null | undefined, state: State, ventureId: string, agentId: string = HARNESS_AGENT): Record<string, string> {
  const allowances = ((store ? SESSION.get(store)?.get(ventureId) : undefined) ?? []).filter(allowance => allowance.agentId === agentId);
  if (!allowances.length) return {};
  const gates = listRecords(state, 'venture-team-gate', ventureId);
  const allowed: Record<string, string> = {};
  for (const allowance of allowances) {
    if (gates.some(gate => gate.agentId === allowance.agentId && gate.stepId === allowance.stepId && gate.at > allowance.at)) continue;
    allowed[allowance.stepId] = allowance.id;
  }
  return allowed;
}

/** Ends allowances: one open vault's (its venture host closing), or every one (what a restart does; tests use it). */
export function endSessionAllowances(store?: object): void {
  if (store === undefined) SESSION = new WeakMap();
  else SESSION.delete(store);
}

/** The agent's steps: the playbook in use, else the accepted plan's (as the team view reads them). Loaded on use. */
async function stepsOf(state: State, venture: VentureRecord): Promise<PlaybookStep[] | null> {
  const { currentPlaybook, deliveryFlagship, playbookSteps } = await import('../delivery/playbook.ts');
  const { acceptedBlueprintOrNull } = await import('../delivery/shared.ts');
  const playbook = currentPlaybook(state, venture);
  if (playbook) return playbook.steps;
  const plan = acceptedBlueprintOrNull(state, venture);
  if (!plan) return null;
  try { return playbookSteps(plan, deliveryFlagship(venture, plan)); } catch { return null; }
}

/**
 * venture.policy.allowSession { stepId } (approve, app only): at auto with spot checks, lets a held step below the floor
 * run without asking while this vault is open. AUTO_LOCKED below that posture; STEP_NOT_FOUND for a step the team does
 * not have; ALLOW_SESSION_FLOOR for a floor step. Records the decision; the allowance itself is kept in memory.
 */
export async function allowSessionHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AllowSessionView> {
  requireAppChannel(ctx, 'venture.policy.allowSession');
  const body = exactPayload(payload, ['stepId'], ['stepId']);
  const stepId = identifier(body.stepId, 'Step');
  const { effectivePosture, sessionStepFloor } = await import('./context.ts');
  const { recordDecision } = await import('../journal/decisions.ts');
  authorize(deps.store, ctx, 'approve');
  const read = deps.store.read();
  const known = currentVenture(read);
  const steps = known ? await stepsOf(read, known) : null;
  const granted = await ventureAction(deps, ctx, 'approve', 'policy.allowSession', tx => {
    check(effectivePosture(tx.state, tx.venture!, HARNESS_AGENT) === 'auto-spot-check', 'AUTO_LOCKED', ALLOW_SESSION_WORDS.locked);
    const step = steps?.find(item => item.id === stepId);
    check(step, 'STEP_NOT_FOUND', 'That step was not found.');
    const floor = sessionStepFloor(tx.state, tx.venture!, step);
    check(floor === null, 'ALLOW_SESSION_FLOOR', ALLOW_SESSION_WORDS.floor(floor ?? ''));
    const record = recordDecision(tx, { subject: `step:${step.id}`, action: 'allow-session', who: 'owner', ruleId: null, reason: ALLOW_SESSION_WORDS.reason(step.title), rowId: null });
    return { allowance: { id: record.id, agentId: HARNESS_AGENT, stepId: step.id, at: tx.now, by: ctx.memberId }, ventureId: tx.venture!.id, title: step.title };
  });
  const vault = SESSION.get(deps.store) ?? new Map<string, Allowance[]>();
  const kept = (vault.get(granted.ventureId) ?? []).filter(item => !(item.agentId === granted.allowance.agentId && item.stepId === granted.allowance.stepId));
  vault.set(granted.ventureId, [...kept, granted.allowance]);
  SESSION.set(deps.store, vault);
  return { stepId: granted.allowance.stepId, line: ALLOW_SESSION_WORDS.done(granted.title) };
}
