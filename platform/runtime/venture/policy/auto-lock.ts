// Chausar venture launcher, policy (Ink v2 wave 4, package 4J15, the founder's decision): the lock on auto with spot
// checks, on its own with no imports from the venture packages, so the policy context, the launch ladder, Team and
// "allow for this session" can all read it without a cycle. Nothing in the engine opens it: there is no setting,
// method or record that does.
import { ChausarError } from '../../contracts.ts';
import type { LaunchStage, Posture } from '../contracts.ts';

export const AUTO_LOCKED_WORDS = "Routine-step approval is not available yet.";
/** The loosest posture any agent works at while auto is locked: a vault that says auto still asks at each step. */
export const LOCKED_POSTURE_CAP: Posture = 'approve-each';

/** The lock. Throws AUTO_LOCKED for the auto rung, a posture or a launch stage; anything else passes. */
export function autoLocked(rung: Posture | LaunchStage | string): void {
  if (rung === 'auto-spot-check') throw new ChausarError('AUTO_LOCKED', AUTO_LOCKED_WORDS);
}
