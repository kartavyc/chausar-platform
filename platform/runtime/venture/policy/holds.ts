// Chausar venture launcher, policy (P2-posture): tool calls held for the owner, and the gate before an outside effect.
// A held call did not run. It becomes a question on Today; the owner's answer decides it. Only the exact approve answer
// from the owner approves, and an approval covers that one tool with that one input, once, in the next act turn. Any
// other answer declines it and goes to the agent as the owner's words.
import { ChausarError } from '../../contracts.ts';
import type { ApprovalSeal, HarnessState, PolicyHold, Posture } from '../contracts.ts';
import type { FloorKind } from './floor.ts';
import { ladderPolicy, type Approval } from './ladder.ts';
import { evaluateSync, type Policy, type Verdict } from './verdict.ts';
import type { PolicyContext } from './ladder.ts';

/** The two answers Today's buttons send. The agent reads them as the owner's answer. */
export const HOLD_APPROVE_ANSWER = 'Yes. Run that exact call again, once.';
export const HOLD_DECLINE_ANSWER = 'No. Do not run that call. Go on without it.';

/** The owner's question for a held call. Words only: the reason, the tool and what an approval does. */
export function holdQuestion(hold: Pick<PolicyHold, 'reason' | 'tool'>): string {
  return `${hold.reason} The agent wants to run ${hold.tool}. Let it run once?`;
}

/** The waiting hold whose question is this hand-off, or null. */
export function holdOfHandoff(state: Pick<HarnessState, 'holds'>, handoffIndex: number): PolicyHold | null {
  return (state.holds ?? []).find(hold => hold.handoff === handoffIndex && hold.status === 'waiting') ?? null;
}

/** Decides the hold behind an answered hand-off, on a state the caller already copied. */
export function decideHold(state: HarnessState, handoffIndex: number, answer: string, by: 'owner' | 'practice-client'): void {
  const hold = holdOfHandoff(state, handoffIndex);
  if (!hold) return;
  if (by === 'owner' && answer === HOLD_APPROVE_ANSWER) {
    hold.status = 'approved';
    hold.validTurn = state.used.turns + 1;
  } else {
    hold.status = 'declined';
  }
}

/**
 * The check before an outside effect: the floor and every other effect ask at every posture; only the owner's
 * approval bound to this action's digest lets it through. Throws POLICY_ASK or POLICY_DENIED with plain words.
 */
export function gateEffect(
  action: { name: string; digest: string; touches?: readonly FloorKind[] }, approval: Approval,
  options: { posture?: Posture; policies?: readonly Policy<PolicyContext>[] } = {},
): Verdict {
  const context: PolicyContext = { posture: options.posture ?? 'approve-each', approval, gates: {}, stepsByTool: {} };
  const verdict = evaluateSync([...(options.policies ?? []), ladderPolicy], { phase: 'outside-effect', ...action }, context);
  if (verdict.verdict !== 'allow') throw new ChausarError(verdict.verdict === 'ask' ? 'POLICY_ASK' : 'POLICY_DENIED', verdict.reason);
  return verdict;
}

/**
 * The owner approval a claimed journal entry carries, for gateEffect: its seal, spent by this claim, bound to the
 * entry's own digest. Anything else (no seal, a seal not used yet, no approver) is no approval, so the gate asks.
 */
export function sealApproval(entry: { approval?: ApprovalSeal | null }, entryDigest: string): Approval {
  const seal = entry.approval ?? null;
  return seal && seal.usedAt !== null && typeof seal.approvedBy === 'string' && seal.approvedBy.length > 0 && entryDigest.length > 0
    ? { kind: 'owner-action', digest: entryDigest, memberId: seal.approvedBy } : { kind: 'none' };
}
