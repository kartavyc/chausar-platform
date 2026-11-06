// W6 6G5 (D44): which routine run a piece of work belongs to. The routine runner sends a routine's prompt through the
// same chat code as the owner's own words; while it does, this scope names the routine and the run, so the model port
// can write them on the call record and its charge without threading an id through every chat path. Node keeps the
// scope across awaits; outside a routine run it is undefined.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelPresetId } from '../contracts.ts';

/**
 * C7: presetId, when a routine run goes to its backup AI (agents/routine-backup.ts): the model port sends by that AI and
 * the chat consent reads its backup consent. draftOnly, for a run an event started: its answer is words, a draft or a
 * proposal for Today, nothing more.
 */
export type RoutineScope = { routineId: string; runId: string; presetId?: ModelPresetId; draftOnly?: true };

const SCOPE = new AsyncLocalStorage<RoutineScope>();

/** Runs work as part of one routine run. */
export function withRoutineScope<T>(scope: RoutineScope, work: () => Promise<T>): Promise<T> {
  return SCOPE.run({ routineId: scope.routineId, runId: scope.runId, ...(scope.presetId ? { presetId: scope.presetId } : {}), ...(scope.draftOnly ? { draftOnly: true as const } : {}) }, work);
}

/** The routine run the current work belongs to, or undefined. */
export function currentRoutineScope(): RoutineScope | undefined {
  const scope = SCOPE.getStore();
  return scope ? { ...scope } : undefined;
}
