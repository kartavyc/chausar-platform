// W6 6G5 (D44): which routine run a piece of work belongs to. The routine runner sends a routine's prompt through the
// same chat code as the owner's own words; while it does, this scope names the routine and the run, so the model port
// can write them on the call record and its charge without threading an id through every chat path. Node keeps the
// scope across awaits; outside a routine run it is undefined.
import { AsyncLocalStorage } from 'node:async_hooks';

export type RoutineScope = { routineId: string; runId: string };

const SCOPE = new AsyncLocalStorage<RoutineScope>();

/** Runs work as part of one routine run. */
export function withRoutineScope<T>(scope: RoutineScope, work: () => Promise<T>): Promise<T> {
  return SCOPE.run({ routineId: scope.routineId, runId: scope.runId }, work);
}

/** The routine run the current work belongs to, or undefined. */
export function currentRoutineScope(): RoutineScope | undefined {
  const scope = SCOPE.getStore();
  return scope ? { routineId: scope.routineId, runId: scope.runId } : undefined;
}
