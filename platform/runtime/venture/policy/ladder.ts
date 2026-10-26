// Chausar venture launcher, policy (P2-posture): Chausar's own policy, the ladder, the gates and the floor as one check.
//
// Before a harness tool call:
// - a draft that carries a flag to issue it for real is denied (policy/floor.ts);
// - a tool outside the run's grant is denied, and so is a tool that does not say what it does (policy/effects.ts);
// - the two tools that only record a request (outbox.propose, agent.delegate) run: nothing leaves Chausar until the
//   owner approves the exact request they recorded, and that approval is checked again before the effect, so the
//   taint latch is met by that approval rather than asked twice;
// - once outside content entered the run (the taint latch, policy/taint.ts; a real order is latched from its first
//   turn), any other call that writes, sends, reaches outside, moves money or reads private data asks at every posture,
//   and only the owner's approval of that exact call (an approved hold, or an approval bound to its digest) opens it;
//   a turn approval or standing consent never does;
// - a tool whose call would itself touch the floor asks, and only the owner's approval of that exact action opens it;
// - otherwise the strictest gate of the steps that grant the tool decides. A step on hold (the default) asks. An auto
//   step runs alone only at auto with spot checks; below that the posture asks.
// An ask is answered by an approval: the owner approving this turn's exact text (a real order, one turn at a time),
// standing consent on made-up clients (rehearsals), the owner approving this exact action, or an approved hold for
// exactly this call in this turn. The first two never cover the floor.
//
// Before an outside effect: the floor asks at every posture, and so does any other effect; only the owner's approval
// bound to that action's digest lets it through.
import type { PolicyHold, Posture, TaintMark, WorkRunRef } from '../contracts.ts';
import { declaresEffects } from './effects.ts';
import { draftIssueFlag, floorOf, floorWords, type PolicyAction } from './floor.ts';
import { POSTURE_WORDS, runPosture } from './posture.ts';
import { latchedBy, TAINT_WORDS } from './taint.ts';
import type { Policy, PolicyAnswer } from './verdict.ts';

/** Who approved the action, if anyone. owner-action binds to one action's digest. */
export type Approval =
  | { kind: 'none' }
  | { kind: 'practice' }
  | { kind: 'owner-turn'; callId?: string | null }
  | { kind: 'owner-action'; digest: string; memberId: string };

export type PolicyContext = {
  posture: Posture; // already tightened: business, agent and run
  approval: Approval;
  gates: Readonly<Record<string, 'auto' | 'hold'>>; // per step id; a step missing here is on hold
  stepsByTool: Readonly<Record<string, readonly string[]>>; // the steps that grant each tool
  stepTitles?: Readonly<Record<string, string>>;
  grant?: readonly string[];
  holds?: readonly PolicyHold[];
  turn?: number; // the act turn being run
  taint?: TaintMark | null; // when outside content first entered the run; absent or null while it is clean
  // Ink v2 wave 4 (4J1): steps the owner allowed for this engine session (policy/allow-session.ts), step id to the
  // decision that allowed it. Like Auto for that step, in memory only; never the floor or the taint latch.
  session?: Readonly<Record<string, string>>;
};

/** Tools whose call only records a request for the owner; the effect is asked about when it is applied. */
export const RECORDS_ONLY: readonly string[] = Object.freeze(['outbox.propose', 'agent.delegate']);
const OUTSIDE = 'This acts outside Chausar, so it waits for you.';
const NO_EFFECTS = 'This tool does not say what it does, so it was blocked.';

const answer = (verdict: PolicyAnswer['verdict'], code: string, reason: string, extra: Partial<PolicyAnswer> = {}): PolicyAnswer => ({ verdict, code, reason, ...extra });

function ownerApproved(action: PolicyAction, ctx: PolicyContext): boolean {
  return ctx.approval.kind === 'owner-action' && typeof action.digest === 'string' && action.digest.length > 0 && action.digest === ctx.approval.digest;
}

function approvedHold(action: PolicyAction, ctx: PolicyContext): PolicyHold | undefined {
  if (ctx.turn === undefined || !action.inputDigest) return undefined;
  return (ctx.holds ?? []).find(hold => hold.status === 'approved' && hold.tool === action.name && hold.inputDigest === action.inputDigest && hold.validTurn === ctx.turn);
}

function decide(action: PolicyAction, ctx: PolicyContext): PolicyAnswer {
  const stale = draftIssueFlag(action);
  if (stale) return answer('deny', 'draft_issue_flag', stale);
  const floor = floorOf(action);
  if (action.phase === 'outside-effect') {
    if (ownerApproved(action, ctx)) return answer('allow', 'owner_approved', 'You approved this.', { floor });
    return floor.length ? answer('ask', 'floor', floorWords(floor), { floor }) : answer('ask', 'outside', OUTSIDE, { floor });
  }
  if (ctx.grant && !ctx.grant.includes(action.name)) return answer('deny', 'not_granted', `${action.name} is not granted to this agent.`);
  if (!declaresEffects(action)) return answer('deny', 'no_effects', NO_EFFECTS);
  // A recorded request reaches nothing until the owner approves that exact request, which also meets the taint latch:
  // asking first for the call too would ask twice, and would need the agent to write the same words again.
  if (RECORDS_ONLY.includes(action.name)) {
    return answer('allow', 'records_only', 'It only records a request. Nothing leaves Chausar until you approve that exact request.', { floor });
  }
  // The taint latch: only the owner's approval of this exact call opens a latched effect.
  const latched = latchedBy(action, ctx.taint).length > 0;
  const latchHold = latched ? approvedHold(action, ctx) : undefined;
  if (latched && !latchHold && !ownerApproved(action, ctx)) return answer('ask', 'tainted', TAINT_WORDS, { floor });
  if (floor.length) {
    return ownerApproved(action, ctx) ? answer('allow', 'owner_approved', 'You approved this.', { floor }) : answer('ask', 'floor', floorWords(floor), { floor });
  }
  if (latched) {
    const step = ctx.stepsByTool[action.name]?.[0] ?? null;
    return latchHold ? answer('allow', 'hold_approved', 'You let this call run once.', { step, holdId: latchHold.id }) : answer('allow', 'owner_approved', 'You approved this.', { step });
  }
  const steps = ctx.stepsByTool[action.name] ?? [];
  // 4J1: a step the owner allowed for this session counts as Auto here (the floor and the latch asked above already).
  const onHold = (id: string) => (ctx.gates[id] ?? 'hold') === 'hold';
  const held = steps.find(id => onHold(id) && !Object.hasOwn(ctx.session ?? {}, id));
  let ask: PolicyAnswer;
  if (!steps.length || held !== undefined) {
    const title = held !== undefined ? ctx.stepTitles?.[held] : undefined;
    ask = answer('ask', 'step_on_hold', title ? `${title} is on hold, so it waits for you.` : 'This step is on hold, so it waits for you.', { step: held ?? null });
  } else if (ctx.posture === 'auto-spot-check') {
    const allowedForSession = steps.find(onHold);
    if (allowedForSession !== undefined) return answer('allow', 'session_allowed', 'You allowed this step for this session.', { step: allowedForSession });
    return answer('allow', 'auto', 'This step runs on its own, with spot checks.', { step: steps[0] });
  } else {
    ask = answer('ask', 'posture', `${POSTURE_WORDS[ctx.posture]}, each step waits for you.`, { step: steps[0] });
  }
  const hold = approvedHold(action, ctx);
  if (hold) return answer('allow', 'hold_approved', 'You let this call run once.', { step: ask.step ?? null, holdId: hold.id });
  if (ownerApproved(action, ctx)) return answer('allow', 'owner_approved', 'You approved this.', { step: ask.step ?? null });
  if (ctx.approval.kind === 'owner-turn') return answer('allow', 'owner_turn', 'You approved this turn before it ran.', { step: ask.step ?? null });
  if (ctx.approval.kind === 'practice') return answer('allow', 'practice', 'Made-up clients only, under your standing consent.', { step: ask.step ?? null });
  return ask;
}

/** Chausar's built-in policy. Pure and synchronous, so it also runs inside a vault transaction. */
export const ladderPolicy: Policy<PolicyContext> = Object.freeze({ id: 'ladder', decide });

/**
 * What the harness checks each tool call against: the context from the vault (policy/context.ts) and any further
 * policies, which run before the ladder (a deny from any of them stops the call).
 */
export type HarnessPolicy = { context: PolicyContext; policies?: readonly Policy<PolicyContext>[]; timeoutMs?: number };

/**
 * The context when a run was put together without one. Made-up clients run under standing consent; a real order has
 * no approval and no gates, so every call waits for the owner: it fails closed.
 */
export function defaultPolicyContext(runRef: WorkRunRef): PolicyContext {
  return {
    posture: runPosture(runRef) ?? 'approve-each',
    approval: runRef.kind === 'delivery' ? { kind: 'none' } : { kind: 'practice' },
    gates: {}, stepsByTool: {},
  };
}
