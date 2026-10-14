/** Purge and scheduled work for the lane, collected from each part. */
import type { Context, State } from '../contracts.ts';
import type { ModuleHost, SchedulerHost } from '../modules/types.ts';
import { peekLane } from './lane-state.ts';

type PurgeReason = { sourceIds: readonly string[]; removedIds: ReadonlySet<string>; at: string };
type Purge = (state: State, reason: PurgeReason) => number;
type Tick = (ctx: Context, host: ModuleHost, scheduler: SchedulerHost) => Promise<unknown[]>;

const purges: Purge[] = [];
const ticks: Tick[] = [];
/** Each part registers its own purge and tick at import time. */
export function onPurge(purge: Purge) { purges.push(purge); }
export function onTick(tick: Tick) { ticks.push(tick); }

export function purgeLane(state: State, reason: PurgeReason): number {
  if (!peekLane(state)) return 0;
  return purges.reduce((removed, purge) => removed + purge(state, reason), 0);
}
export async function tickLane(ctx: Context, host: ModuleHost, scheduler: SchedulerHost): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const tick of ticks) results.push(...await tick(ctx, host, scheduler));
  return results;
}
