// Chausar venture launcher, policy (Ink v2 wave 4, package 4J15, the founder's decision): the lock on auto with spot
// checks, on its own with no imports from the venture packages, so the policy context, the launch ladder, Team and
// "allow for this session" can all read it without a cycle. Nothing in the engine opens it: there is no setting,
// method or record that does. The readiness view (policy/auto-gate.ts) says how close a business is, nothing more.
import { ChausarError } from '../../contracts.ts';
import type { LaunchStage, Posture } from '../contracts.ts';

/** The drill runs in a row the lock words name; the readiness drills item counts the same number. */
export const CLEAN_DRILL_RUNS = 2;
export const AUTO_LOCKED_WORDS = "Auto with spot checks is built but locked. It opens after two clean drill runs and the founder's yes.";
/** The loosest posture any agent works at while auto is locked: a vault that says auto still asks at each step. */
export const LOCKED_POSTURE_CAP: Posture = 'approve-each';

/** The lock. Throws AUTO_LOCKED for the auto rung, a posture or a launch stage; anything else passes. */
export function autoLocked(rung: Posture | LaunchStage | string): void {
  if (rung === 'auto-spot-check') throw new ChausarError('AUTO_LOCKED', AUTO_LOCKED_WORDS);
}
