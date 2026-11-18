// Chausar venture launcher, delivery: the tick's entry for questions to the owner. The old round loop's questions ran
// out after 24 hours and stopped their run (4J13, A13). An AI job's waits on the owner have no clock, on purpose, and the
// machine says why in one place (run-machine.ts OWNER_WAIT_LIMIT_MS): a question for a missing fact holds nothing open
// (no AI session runs and nothing is sent, so nothing can go through late, 4J16), a draft waits for its verdict for as
// long as the owner takes, and a step's approval ends with its AI session. The routine tick (agents/routine-runner.ts)
// still asks under this name on every tick, and nothing is ever due.
import type { Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { OWNER_WAIT_LIMIT_MS } from './run-machine.ts';

/** The ids of the runs whose question ran out and were stopped: none, while no wait on the owner has a limit. */
export async function expireQuestions(_deps: VentureDeps, _ctx: Context): Promise<string[]> {
  if (Object.values(OWNER_WAIT_LIMIT_MS).some(limit => limit !== null)) throw new Error('A wait on the owner got a time limit, and nothing stops its run yet. Add the event to run-machine.ts first.');
  return [];
}
