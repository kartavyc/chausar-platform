import type { State } from '../contracts.ts';
import type { MethodSpec } from '../modules/types.ts';

export const recipeMethods: Record<string, MethodSpec> = {};
export function purgeRecipes(_state: State, _reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string> }): number { return 0; }
