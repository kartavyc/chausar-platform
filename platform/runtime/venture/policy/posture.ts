// Chausar venture launcher, policy (P2-posture): the posture ladder.
// rehearsal -> shadow -> approve each -> auto with spot checks. The business posture is its launch stage
// (delivery/launch.ts); there is no second ladder. An agent, a run and a step are narrower scopes: each can only
// tighten the one around it, never loosen it, so the strictest of them wins.
// The tighten-only rule follows yc-software/qm composeSecurityPosture (MIT); this is a rewrite, not a copy.
import { check } from '../../contracts.ts';
import type { LaunchStage, Posture, WorkRunRef } from '../contracts.ts';

/** Strictest first. */
export const POSTURES: readonly Posture[] = Object.freeze(['rehearsal', 'shadow', 'approve-each', 'auto-spot-check'] as const);

const STAGE_POSTURE: Readonly<Record<LaunchStage, Posture>> = Object.freeze({
  rehearsal: 'rehearsal', shadow: 'shadow', 'approve-each': 'approve-each',
  // Approving a sample is planned on the launch ladder; until it exists the honest posture is approving each one.
  'approve-sample': 'approve-each', 'auto-spot-check': 'auto-spot-check',
});

/** How a reason names each posture: "In shadow, each step waits for you." */
export const POSTURE_WORDS: Readonly<Record<Posture, string>> = Object.freeze({
  rehearsal: 'In rehearsal', shadow: 'In shadow', 'approve-each': 'While you approve each one', 'auto-spot-check': 'With spot checks',
});

/** 0 for the strictest. An unknown posture is refused, never ranked. */
export function postureRank(posture: Posture): number {
  const rank = POSTURES.indexOf(posture);
  check(rank >= 0, 'INVALID_VENTURE_REQUEST', 'That is not a posture.');
  return rank;
}

/** The business posture for a launch stage. */
export function postureOfStage(stage: LaunchStage): Posture {
  const posture = STAGE_POSTURE[stage];
  check(posture, 'INVALID_VENTURE_REQUEST', 'That is not a launch stage.');
  return posture;
}

/** The wider posture tightened by each narrower one given; a missing scope changes nothing. Never looser than any. */
export function tighten(wider: Posture, ...narrower: (Posture | null | undefined)[]): Posture {
  let result = wider;
  postureRank(result);
  for (const scope of narrower) {
    if (scope === null || scope === undefined) continue;
    if (postureRank(scope) < postureRank(result)) result = scope;
  }
  return result;
}

/** A run's own scope: made-up clients are always a rehearsal, whatever the business stage. A real order adds nothing. */
export function runPosture(runRef: WorkRunRef): Posture | null {
  return runRef.kind === 'delivery' ? null : 'rehearsal';
}

/** A step's gate: on hold until the owner sets it to auto; a floor step stays on hold whatever was stored. */
export function stepGate(stored: 'auto' | 'hold' | undefined, floor: boolean): 'auto' | 'hold' {
  if (floor) return 'hold';
  return stored ?? 'hold';
}
