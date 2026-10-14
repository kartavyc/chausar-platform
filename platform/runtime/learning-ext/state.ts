import { check, type Context, type State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import { assertSourceAccess } from '../trust.ts';

export const LANE_ID = 'learning-ext';

/** Each part of the lane keeps its own area inside the lane namespace. */
export type LaneState = Record<string, unknown>;

export function area<T>(state: State, name: string, init: () => T): T {
  const lane = moduleState<LaneState>(state, LANE_ID, () => ({}));
  if (!Object.hasOwn(lane, name)) lane[name] = init();
  return lane[name] as T;
}
export function peekArea<T>(state: State, name: string): T | undefined {
  const lane = peekModuleState<LaneState>(state, LANE_ID);
  return lane && Object.hasOwn(lane, name) ? lane[name] as T : undefined;
}

/** True when the caller may see every named source; used to filter views quietly. */
export function canSee(state: State, ctx: Context, sourceIds: readonly string[]): boolean {
  try { assertSourceAccess(state, ctx, [...sourceIds]); return true; } catch { return false; }
}

/** Bounded opaque identifiers supplied by callers. */
export function ids(value: unknown, name = 'identifiers', max = 64): string[] {
  if (value === undefined) return [];
  check(Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(item)), 'INVALID_REQUEST', `Give at most ${max} plain ${name}.`);
  return [...new Set(value as string[])].sort();
}
export function oneOf<T extends string>(value: unknown, list: readonly T[], code = 'INVALID_REQUEST', message = 'Choose a registered option.'): T {
  check(typeof value === 'string' && (list as readonly string[]).includes(value), code, message);
  return value as T;
}
export function limitOf(value: unknown, fallback = 50, max = 500): number {
  if (value === undefined) return fallback;
  check(Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= max, 'INVALID_REQUEST', `Ask for 1 to ${max} items.`);
  return value as number;
}
