/** The lane's private namespace inside workspace state, one sub-record per part. */
import type { State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';

export const LANE_ID = 'reports-tools-trust';
export type LaneState = { reports: Record<string, any>; trust: Record<string, any>; tools: Record<string, any> };

export function laneState(state: State): LaneState {
  const lane = moduleState<LaneState>(state, LANE_ID, () => ({ reports: {}, trust: {}, tools: {} }));
  lane.reports ??= {}; lane.trust ??= {}; lane.tools ??= {};
  return lane;
}
export function peekLane(state: State): LaneState | undefined { return peekModuleState<LaneState>(state, LANE_ID); }
