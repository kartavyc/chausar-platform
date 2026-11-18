// Chausar venture launcher, delivery: the tick's entry to run recovery. Runs once held a renewable lease while one of
// the old round loop's calls was out (4J13, H34). AI jobs hold none: a job is alive exactly while its session runs in
// this process, so there is one recovery, when a vault opens (agent-runtime/recovery.ts recoverRuns, through the
// machine's interrupt). The routine tick (agents/routine-runner.ts) still asks under this name on every tick; only the
// tick of a vault opening (claim limit 1) recovers anything, so startup work is never cut by an ordinary tick.
import type { Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { recoverRuns } from '../agent-runtime/recovery.ts';

/** The ids of the runs interrupted because Chausar stopped while they ran. Never more than once per run. */
export async function recoverLeases(deps: VentureDeps, ctx: Context, claimLimitMs?: number): Promise<string[]> {
  return claimLimitMs === 1 ? recoverRuns(deps, ctx) : [];
}
